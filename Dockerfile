# Use Rust image matching your local version (1.84)
FROM rust:1.84

# Install Node.js 18 (matches your local setup)
RUN apt-get update && apt-get install -y \
    curl \
    build-essential \
    ca-certificates \
    gnupg \
    pkg-config \
    libssl-dev \
    libdbus-1-3 \
    && curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean

# Install Rust components (matches your local)
RUN rustup component add rustfmt rust-analyzer && \
    rustup target add wasm32v1-none

# Install exact Soroban CLI version from your local (22.8.1)
# RUN cargo install soroban-cli --version 22.8.1 --locked

# FAST INSTALL - Pre-built Soroban CLI
RUN curl -sSL -o soroban.tar.gz https://github.com/stellar/soroban-cli/releases/download/v22.8.1/stellar-cli-22.8.1-x86_64-unknown-linux-gnu.tar.gz && \
    tar -xzf soroban.tar.gz && \
    mv stellar /usr/local/bin/soroban && \
    chmod +x /usr/local/bin/soroban && \
    rm soroban.tar.gz


# Verify versions (optional but recommended)
RUN rustc --version && \
    cargo --version && \
    soroban version

# Set working directory
WORKDIR /app

# Optimized layer caching for npm
COPY package.json package-lock.json ./
RUN npm install

# Copy remaining files
COPY . .

EXPOSE 4000
CMD ["npx", "nodemon"]