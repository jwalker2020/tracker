# PocketBase container: binary + migrations, persistent pb_data.
# Build from apps/pb so pb_migrations is in context.

FROM alpine:3.19
RUN apk add --no-cache ca-certificates unzip wget

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
COPY start-pocketbase.sh /app/start-pocketbase.sh
RUN chmod +x /app/start-pocketbase.sh
WORKDIR /app

# Data lives here; mount a volume in compose.
VOLUME /app/pb_data
EXPOSE 8090

# Run migrations on every start, then serve. Script exits non-zero if migrate fails.
CMD ["/app/start-pocketbase.sh"]
