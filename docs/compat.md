# Editor compatibility

The local Playwright fixtures cover standard contenteditable and ProseMirror behavior. Real-site rows remain untested because this environment has no browser session with the extension installed or authenticated editor accounts. Run each check in Chrome with the built extension before release, then record the status, date, and notes here. Do not treat fixture results as real-site passes.

| Editor      | Field type      | Status   | Date tested | Notes                         |
| ----------- | --------------- | -------- | ----------- | ----------------------------- |
| Gmail       | contenteditable | untested | —           | —                             |
| Outlook web | contenteditable | untested | —           | —                             |
| LinkedIn    | contenteditable | untested | —           | —                             |
| Slack       | contenteditable | untested | —           | —                             |
| Notion      | contenteditable | untested | —           | —                             |
| Zendesk     | contenteditable | untested | —           | —                             |
| Salesforce  | contenteditable | untested | —           | —                             |
| Google Docs | custom editor   | untested | —           | Out of scope for this release |
