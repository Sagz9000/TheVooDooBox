FROM rust:latest as builder

WORKDIR /usr/src/app
COPY . .

RUN cargo install --path .

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y libssl-dev ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /usr/local/cargo/bin/hyper-bridge /usr/local/bin/hyper-bridge
COPY assets /app/assets

CMD ["hyper-bridge"]
