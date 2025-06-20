# Base image with Rust
FROM rust:1.75

# Install Soroban CLI
RUN apt-get update && apt-get install -y \
    curl unzip pkg-config libssl-dev build-essential

RUN curl -sSf https://install.soroban.stellar.org | bash

# Set the correct PATH for Soroban CLI
ENV PATH="/root/.cargo/bin:${PATH}"

# Create app directory
WORKDIR /app

# Copy backend code
COPY . .

# Install Node dependencies if needed (optional)
# RUN npm install

# Expose port
EXPOSE 4000

# Start server
CMD ["node", "server.js"]
