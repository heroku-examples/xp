// Separate module so the startup hook, a normally-compiled binary, keeps its
// own dependencies. It is installed next to the dyno-proxy binary (see
// buildpack/bin/build and .../compile).
module xp/dyno-proxy-start-hook

go 1.23

require github.com/BurntSushi/toml v1.6.0
