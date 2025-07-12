# syntax=docker/dockerfile:1

ARG RUST_VERSION=1.81

FROM rust:${RUST_VERSION}

ENV NODE_ENV=production

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
    rustup target add wasm32-unknown-unknown

# Install - Pre-built Soroban CLI
RUN curl -sSL -o soroban.tar.gz https://github.com/stellar/soroban-cli/releases/download/v22.8.1/stellar-cli-22.8.1-x86_64-unknown-linux-gnu.tar.gz && \
    tar -xzf soroban.tar.gz && \
    mv stellar /usr/local/bin/soroban && \
    chmod +x /usr/local/bin/soroban && \
    rm soroban.tar.gz

WORKDIR /app

# Download dependencies as a separate step to take advantage of Docker's caching.
# Leverage a cache mount to /root/.npm to speed up subsequent builds.
# Leverage a bind mounts to package.json and package-lock.json to avoid having to copy them into
# into this layer.
RUN --mount=type=bind,source=package.json,target=package.json \
    --mount=type=bind,source=package-lock.json,target=package-lock.json \
    --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]