# ZCode standard proxy provenance

The optional runtime is separately installed from [TriDefender/zcode-api](https://github.com/TriDefender/zcode-api/tree/9880d91579fdb9d3e59c2bb900add3ab86722003), version **4.8.5**, commit `9880d91579fdb9d3e59c2bb900add3ab86722003`.

Copyright (c) 2026 TriDefender and the ZCode Proxy contributors. The upstream runtime and `upstream-response.patch`, which modifies its handler by adding an optional response observer, retain **CC-BY-NC-SA-4.0** attribution. The complete, unchanged upstream license is included as `LICENSE.zcode-api` and remains `LICENSE` in each installed runtime. The plugin's MIT license does not relicense that runtime or its derivative patch.

The local bridge, installer, and isolation configuration were adapted from the MIT AI credit gateway project (`spdw666/multi-agent-checkin-dsh`) by this project in October 2026. Plugin modifications keep all private runtime settings under the selected plugin data profile, generate an independent loopback key and port, disable non-model background features, isolate the upstream credential-store path, preserve the complete model/tool request, and retain official response diagnostics. No original gateway installation, credentials, configuration, or database are reused.

`engine/vendor/zcode-context` is a different historical upstream snapshot with separately recorded MIT provenance; it does not establish the license of this optional v4.8.5 runtime.
