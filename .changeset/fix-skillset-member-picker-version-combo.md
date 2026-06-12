---
"ornn-web": patch
---

Skillset create/edit form: the Members picker now requires an explicit skill + published-version combination. Clicking a skill from the name typeahead fetches its versions and shows a chooser (concrete `name@X.Y` entries, newest first with "latest" badge). Raw `name@ver` entry still works. This prevents accidentally pinning only a skill name (implicit latest); every added member ref is now a deliberate pinned combination, consistent with how members are modeled and displayed on the detail page (closure, graph, chips).