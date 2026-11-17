#!/usr/bin/env bash
set -euo pipefail
set +x

# Only native CI may produce publication archives; local builds are smoke only.
python3 scripts/ci/staging_image.py guard build

source_sha=$(git rev-parse HEAD)
test "$source_sha" = "$GITHUB_SHA"
source_tree=$(git rev-parse 'HEAD^{tree}')
image="ornn-staging-${COMPONENT}:ci-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
out=staging-image-out
mkdir "$out"

build_args=(--platform linux/amd64 --file "ornn-${COMPONENT}/Dockerfile.staging"
  --provenance=false --sbom=false --metadata-file "$out/build-metadata.json"
  --tag "$image"
  --label org.opencontainers.image.source=https://github.com/ChronoAIProject/Ornn
  --label "org.opencontainers.image.revision=$source_sha"
  --label "org.opencontainers.image.version=git-$source_sha")
web_build_identity=
if test "$COMPONENT" = web; then
  web_build_identity=$(python3 scripts/ci/staging_web_identity.py "$out/web-build-inputs.json")
  build_args+=(--build-arg "GIT_COMMIT=$web_build_identity"
    --label "io.chronoai.ornn.web-build-identity=$web_build_identity")
fi
docker build "${build_args[@]}" .
docker image inspect "$image" > "$out/image-inspect.json"
echo "Verify $COMPONENT image for revision $source_sha"

export source_sha source_tree image out web_build_identity
python3 scripts/ci/staging_image.py inspect
bash scripts/ci/staging-smoke-image.sh "$COMPONENT" "$image" "$source_sha" "$out" "$web_build_identity"

archive="ornn-${COMPONENT}-linux-amd64.docker.tar.gz"
docker image save "$image" | gzip -n > "$out/$archive"
export archive
python3 - <<'PY'
import hashlib,json,os
from pathlib import Path
from scripts.ci.staging_image import saved_config, verify_config
r=Path(os.environ['out']); p=r/os.environ['archive']; h=hashlib.sha256()
with p.open('rb') as f:
    for b in iter(lambda:f.read(1024*1024),b''): h.update(b)
i=json.loads((r/'image-inspect.json').read_text())[0]
config_digest, config = saved_config(p)
m={'schema':'ornn-ci-native-image-v1','component':os.environ['COMPONENT'],
   'source':'https://github.com/ChronoAIProject/Ornn',
   'sourceRevision':os.environ['source_sha'],'sourceTree':os.environ['source_tree'],
   'platform':'linux/amd64','user':i['Config']['User'],'imageId':i['Id'],
   'configDigest':config_digest,
   'labels':i['Config']['Labels'],'layerDiffIds':i['RootFS']['Layers'],
   'archive':p.name,'archiveBytes':p.stat().st_size,'archiveSha256':h.hexdigest(),
   'workflow':{'repository':os.environ['GITHUB_REPOSITORY'],'runId':os.environ['GITHUB_RUN_ID'],
               'runAttempt':os.environ['GITHUB_RUN_ATTEMPT'],'ref':os.environ['GITHUB_REF'],
               'event':os.environ['GITHUB_EVENT_NAME']},
   'checks':{'numericNonroot':True,'nativeAmd64':True,'sourceLabels':True,
             'containerSmoke':True,'DBIdentityOrClusterQualification':False}}
if os.environ['COMPONENT'] == 'web':
    m['webBuildIdentity'] = os.environ['web_build_identity']
verify_config(config, m, os.environ)
(r/'metadata.json').write_text(json.dumps(m,indent=2)+'\n')
PY
