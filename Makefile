.PHONY: hook buildpack-package buildpack-tarball

# Version generation: git commit count + short hash.
VERSION ?= $(shell git rev-list --count HEAD 2>/dev/null || echo "0").$(shell git rev-parse --short HEAD 2>/dev/null || date +%s)
IMAGE ?= ghcr.io/heroku-examples/xp:dev
TARGET ?= linux/amd64

HOOK_DIR = buildpack/dyno-proxy-start-hook
HOOK_BIN = buildpack/bin/dyno-proxy-start-hook-linux

# Build the startup hook for every arch bin/build and bin/compile can install.
# The binaries are build output (gitignored), not committed.
hook:
	cd $(HOOK_DIR) && go test ./...
	cd $(HOOK_DIR) && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags '-s -w' -o ../bin/dyno-proxy-start-hook-linux-amd64 .
	cd $(HOOK_DIR) && CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -ldflags '-s -w' -o ../bin/dyno-proxy-start-hook-linux-arm64 .

# Package and publish the composite CNB buildpack (dyno-proxy + XP) to $(IMAGE).
# Expects the hook binaries from `make hook`; the dependencies in
# buildpack/bin/package.toml are resolved relative to that file.
buildpack-package:
	pack buildpack package $(IMAGE) --config buildpack/bin/package.toml --target $(TARGET) --publish

# Classic (non-CNB) buildpack archive, usable with `heroku buildpacks:add <url>`.
buildpack-tarball:
	tar -czf xp-buildpack.tgz -C buildpack --exclude=dyno-proxy-start-hook --exclude=.DS_Store .
