# PocketBase container: binary + migrations, persistent pb_data.
# Build from apps/pb so pb_migrations is in context.

FROM alpine:3.19
RUN apk add --no-cache ca-certificates unzip

# Use 0.23+ so JS migrations get app.save() (0.22 passes db and uses Dao).
ARG PB_VERSION=0.23.0
# Map Docker TARGETARCH to PocketBase release arch name.
ARG TARGETARCH
RUN case ${TARGETARCH} in \
    amd64) PB_ARCH=amd64 ;; \
    arm64) PB_ARCH=arm64 ;; \
    *) PB_ARCH=amd64 ;; \
    esac && \
  wget -q -O /tmp/pb.zip \
    "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${PB_ARCH}.zip" && \
  unzip /tmp/pb.zip -d /app && \
  rm /tmp/pb.zip && \
  chmod +x /app/pocketbase

COPY pb_migrations /app/pb_migrations
WORKDIR /app

# Data lives here; mount a volume in compose.
VOLUME /app/pb_data
EXPOSE 8090

# Serve runs migrations on first start; listen on all interfaces for Docker network.
CMD ["./pocketbase", "serve", "--http=0.0.0.0:8090"]
