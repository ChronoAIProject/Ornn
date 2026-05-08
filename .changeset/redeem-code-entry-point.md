---
"ornn-web": patch
---

Mount `/settings` route and add a "Redeem code" entry to the user menu (desktop dropdown between "My Organizations" and "Go to NyxID"; mobile menu after "My Profile"). The redeem form shipped in #306 was previously unreachable because `SettingsPage` had no route. Existing NyxID external links are unchanged.

Closes #310.
