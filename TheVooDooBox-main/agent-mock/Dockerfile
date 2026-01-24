FROM rust:latest as builder

WORKDIR /usr/src/app
COPY . .

RUN cargo install --path .

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y libssl-dev ca-certificates && rm -rf /var/lib/apt/lists/*

COPY --from=builder /usr/local/cargo/bin/mallab-mock-agent /usr/local/bin/mallab-mock-agent

CMD ["mallab-mock-agent"]
