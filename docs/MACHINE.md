# Machine integration

The machine section reads OS/hostname, resources and detected Linux capabilities without installing packages or changing services. Prepare assistant stores a machine profile and opens a read-only inspection conversation; its early and native tool gates prevent mutation even if terminal access is enabled elsewhere.

Containers/logs use existing user-accessible CLI connections. Explicitly selected log snippets can be discussed read-only. Common credentials are redacted on a best-effort basis; logs are not automatically saved into lasting memory.

Desktop/tray/sleep/audio/RTC behavior varies by Linux distro/session. Verify actual capabilities rather than treating a fixture as evidence of OS permission.
