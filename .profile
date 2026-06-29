
# download otelite
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/planetf1/otelite/releases/latest/download/otelite-installer.sh | sh
source $HOME/.cargo/env
otelite serve

