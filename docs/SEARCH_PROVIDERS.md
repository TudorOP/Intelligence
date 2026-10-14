# Web and offline search

Settings supports SearXNG, Brave Search and explicit DuckDuckGo/Ecosia engine routes through configured SearXNG. Brave needs an activated account/plan/key. Ecosia can require a custom engine; the UI labels the actual route rather than pretending every provider is directly available.

The menu shows concise names: DuckDuckGo, Ecosia, SearXNG and Brave Search. Descriptions beneath it explain that DuckDuckGo/Ecosia use the configured SearXNG engine and address, while Brave uses its direct API. This is a label clarification, not a change to transport, credential handling or engine validation; no provider fallback is introduced.

Protected credentials, connection testing, bounded results and source citations apply globally, including outside Matrix. Returned webpages are untrusted context; citation links are evidence and do not grant tool authority.

Offline ZIM retrieval is a separate optional native module with user-selected archives. Archive content keeps its own license. Actual accounts, engine availability and native archive behavior require target-host checks.
