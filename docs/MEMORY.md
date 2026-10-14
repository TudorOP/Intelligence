# Memory

Keyword/FTS search is local. Optional CPU ONNX semantic search provisions bge-small weights into user data, reuses caches and keeps keyword search available during setup/offline. Automatic semantic search can be disabled independently.

An optional CPU MiniCPM worker summarizes idle conversations and extracts evidence-backed facts; it pauses for foreground work and releases on idle. Automatic summaries/facts and embedding search have separate switches.

Past-conversation recall respects source/project permissions, temporary chats and exclusions. Generated memories link to source conversations and evidence. Exact duplicate suppression and review of conflicting facts help, but do not guarantee perfect extraction. Edit/Forget remain available; verify material claims against actual user messages.

No model weights are bundled during packaging. Check real first-use downloads, CPU/RAM/lifecycle and privacy behavior on Linux.
