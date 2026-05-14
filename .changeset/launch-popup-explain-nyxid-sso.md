---
"ornn-web": patch
---

LaunchCelebrationPopup — explain the NyxID SSO flow next to the invite code (#519). The popup showed the invite code (`NYX-2XXJI08A`) under a mono label "**NyxID invite · first-time users**" with no further context, so users couldn't tell what to do with the code: where they'd be asked for it, that Ornn's Sign In redirects to NyxID (a separate product — our identity provider), or that they still need to choose GitHub on the NyxID page after pasting the code. Added a short explanatory paragraph below the code chip walking through the actual flow (click Sign In → redirected to NyxID → paste code → continue with GitHub). New i18n key `landing.launchPopup.inviteHelp` in both `en.json` and `zh.json`; layout slot is the previously empty space between the code chip and the "Limited slots" warning.
