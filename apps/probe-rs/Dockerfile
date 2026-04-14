FROM rust:1.86-slim AS build

WORKDIR /src

COPY . .

RUN cargo build --locked --release -p probe-server

FROM gcr.io/distroless/cc-debian12:nonroot

COPY --from=build /src/target/release/probe-server /probe

EXPOSE 8080

ENTRYPOINT ["/probe"]
