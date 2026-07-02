
# download otelite
# curl --proto '=https' --tlsv1.2 -LsSf https://github.com/planetf1/otelite/releases/latest/download/otelite-installer.sh | sh
# source $HOME/.cargo/env
# otelite serve

curl --proto '=https' --tlsv1.2 -fOL https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v0.154.0/otelcol_0.154.0_linux_amd64.tar.gz
tar -xvf otelcol_0.154.0_linux_amd64.tar.gz

./otelcol --config=otel.yaml


