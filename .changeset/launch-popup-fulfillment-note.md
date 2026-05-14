---
"ornn-web": patch
---

LaunchCelebrationPopup — add fulfillment note covering post-redemption flow (#524). Follow-up to #519 (which explained the NyxID SSO login flow). Users still didn't know what happens *after* they sign in and star the repo: how long until the code arrives (24h), where it lands (in-app notification inbox, not email), where to apply it (profile dropdown → "Redeem code"), or where to get help if redemption fails. Added a second body paragraph directly below the existing NyxID-flow paragraph that walks through delivery timing, the bell-icon notification inbox, the profile-dropdown redeem entry, and a discussions-thread link for support. Three new i18n keys (`fulfillmentBefore`, `fulfillmentLinkLabel`, `fulfillmentAfter`) following the same split pattern as `step1Before`/`step1After` so the discussions URL renders inline.
