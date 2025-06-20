# Use official Rust image
FROM rust:1.75

# Install Node.js & dependencies
RUN apt-get update && apt-get install -y \
    curl \
    build-essential \
    ca-certificates \
    gnupg \
    pkg-config \
    libssl-dev \
    && curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean

# Install rustfmt and cargo test comes by default
RUN rustup component add rustfmt

# Install Soroban CLI
RUN cargo install --locked --version 20.0.0 soroban-cli

# Set working directory
WORKDIR /app

# Copy your app code into the container
COPY . .

# Expose backend port
EXPOSE 4000

# Run the server
CMD ["node", "server.js"]
