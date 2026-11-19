import copy
import hashlib
import io
import json
import re
from pathlib import Path
import tempfile
import unittest
import zipfile
from unittest.mock import Mock

from staging_detector_cache import REPO, WORKFLOW, context, restore, unpack, validate_producer


class CacheTrustTests(unittest.TestCase):
    def fixtures(self):
        run={'repository':{'full_name':REPO},'head_repository':{'full_name':REPO},'path':WORKFLOW,
             'event':'push','head_branch':'develop','status':'completed','id':10,'run_attempt':1,'head_sha':'a'*40}
        jobs={'total_count':2,'jobs':[{'name':name,'status':'completed','conclusion':'success',
              'head_sha':'a'*40,'run_id':10,'run_attempt':1} for name in ['gate_tests','image (api)']]}
        archive=io.BytesIO()
        with zipfile.ZipFile(archive,'w') as z: z.writestr('detector-cache.json',json.dumps({'schema':'synthetic'}))
        raw=archive.getvalue()
        artifact={'name':'ornn-detector-api-10-1','expired':False,'id':50,'size_in_bytes':len(raw),
                  'workflow_run':{'id':10,'head_sha':'a'*40},'digest':'sha256:'+hashlib.sha256(raw).hexdigest()}
        env={'GITHUB_REPOSITORY':REPO,'GITHUB_EVENT_NAME':'push','GITHUB_REF':'refs/heads/develop',
             'GITHUB_RUN_ID':'20','GITHUB_RUN_ATTEMPT':'1','COMPONENT':'api'}
        return run,jobs,artifact,raw,env

    def test_pr_fork_release_manual_and_wrong_ref_cannot_restore(self):
        *_,env=self.fixtures()
        for key,value in [('GITHUB_EVENT_NAME','pull_request'),('GITHUB_EVENT_NAME','workflow_dispatch'),
                          ('GITHUB_EVENT_NAME','release'),('GITHUB_REF','refs/pull/1/merge'),
                          ('GITHUB_REPOSITORY','foreign/repo'),('COMPONENT','other')]:
            with self.subTest(key=key,value=value),self.assertRaises(ValueError): context({**env,key:value})

    def test_authenticated_producer_requires_exact_workflow_and_successful_gate_image(self):
        run,jobs,artifact,_,_=self.fixtures()
        validate_producer(run,jobs,artifact,'api')
        for key,value in [('event','pull_request'),('head_branch','other'),('path','other.yml'),
                          ('head_repository',{'full_name':'fork/repo'}),('status','in_progress')]:
            with self.assertRaises(ValueError):validate_producer({**run,key:value},jobs,artifact,'api')
        for key,value in [('conclusion','failure'),('run_attempt',2),('head_sha','b'*40),('run_id',99)]:
            altered=copy.deepcopy(jobs);altered['jobs'][0][key]=value
            with self.assertRaises(ValueError):validate_producer(run,altered,artifact,'api')
        for key,value in [('name','ornn-detector-web-10-1'),('digest','bad'),('expired',True),('size_in_bytes',0)]:
            with self.assertRaises(ValueError):validate_producer(run,jobs,{**artifact,key:value},'api')

    def test_zip_digest_member_names_and_bounds_verified(self):
        _,_,artifact,raw,_=self.fixtures()
        self.assertIsInstance(json.loads(unpack(raw,artifact)),dict)
        with self.assertRaises(ValueError):unpack(raw+b'poison',artifact)
        buf=io.BytesIO()
        with zipfile.ZipFile(buf,'w') as z:z.writestr('../detector-cache.json','{}')
        raw=buf.getvalue();artifact['digest']='sha256:'+hashlib.sha256(raw).hexdigest()
        with self.assertRaises(ValueError):unpack(raw,artifact)

    def test_restore_selects_trusted_artifact_and_misses_failed_producer(self):
        run,jobs,artifact,raw,env=self.fixtures()
        def get(path,binary=False):
            if '/workflows/' in path:return {'workflow_runs':[run]}
            if '/attempts/' in path:return jobs
            if path.endswith('/artifacts?per_page=100'):return {'total_count':1,'artifacts':[artifact]}
            if path.endswith('/50/zip'):return raw
            raise AssertionError(path)
        with tempfile.TemporaryDirectory() as folder:
            dest=Path(folder)/'cache.json'
            self.assertEqual(restore(env,get,dest)['status'],'RESTORED')
            self.assertTrue(dest.exists())
            jobs['jobs'][0]['conclusion']='failure'
            dest.unlink()
            self.assertEqual(restore(env,get,dest)['status'],'MISS_FULL_SCAN')
            self.assertFalse(dest.exists())
        reader=Mock()
        with self.assertRaises(ValueError):restore({**env,'GITHUB_EVENT_NAME':'pull_request'},reader,Path('unused'))
        reader.assert_not_called()

    def test_workflow_keeps_tests_parallel_and_pr_caches_untrusted(self):
        s=(Path(__file__).resolve().parents[2]/'.github/workflows/staging-native-images.yml').read_text()
        self.assertEqual(s.count('python3 -B scripts/ci/staging_gate_shards.py "$QUALIFICATION_SUITE"'),1)
        self.assertIn('suite: [scanner-a, scanner-b, acceptance, content-policy]',s)
        self.assertIn('needs: [gate_shards]',s)
        for component in ['api','web']:
            image=re.split(r'\n  [a-z_]+:\n', s.split('  image_'+component+':\n',1)[1], maxsplit=1)[0]
            publish=re.split(r'\n  [a-z_]+:\n', s.split('  publish_'+component+':\n',1)[1], maxsplit=1)[0]
            self.assertNotIn('self-test.sh',image)
            self.assertIn('needs: [image_'+component+', gate_tests]',publish)
            self.assertNotIn('needs:',image)
            for name in ['Restore authenticated develop detector evidence','Retain sanitized detector evidence']:
                step=image.split('- name: '+name,1)[1].split('      - name:',1)[0]
                self.assertIn("github.event_name == 'push' && github.ref == 'refs/heads/develop'",step)
        self.assertNotIn('pull_request_target',s)
        self.assertNotIn('mode=max',s)
