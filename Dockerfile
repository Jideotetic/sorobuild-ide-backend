ARG RUST_VERSION=1.85

FROM rust:${RUST_VERSION}

RUN apt-get update && \
    apt-get install -y curl ca-certificates gnupg && \
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y \
        build-essential \
        pkg-config \
        libssl-dev \
        libdbus-1-3 \
        nodejs && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Install Rust components
RUN rustup component add rustfmt rust-analyzer rust-src && \
    rustup target add wasm32-unknown-unknown wasm32v1-none && \
    rustup update stable

# Install - Pre-built Soroban CLI
RUN curl -sSL -o soroban.tar.gz https://github.com/stellar/soroban-cli/releases/download/v22.8.1/stellar-cli-22.8.1-x86_64-unknown-linux-gnu.tar.gz && \
    tar -xzf soroban.tar.gz && \
    mv stellar /usr/local/bin/soroban && \
    chmod +x /usr/local/bin/soroban && \
    rm soroban.tar.gz

WORKDIR /app

RUN --mount=type=bind,source=package.json,target=package.json \
    --mount=type=bind,source=package-lock.json,target=package-lock.json \
    --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]