---
"ornn-web": minor
---

Skillset edit form: the "Version" field for publishing a new version is now automatically pre-filled with the next patch (e.g. 1.0 → 1.1) when you open the page. Three compact +patch / +minor / +major buttons appear directly under the input so you can change the bump level without typing. Manual editing still works. The "must be different from current" validation and server bump rules are unchanged. This removes the previous manual tag entry friction for the common case.