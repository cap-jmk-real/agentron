# Red-vs-blue e2e target image (vulnerable service; image name is neutral so Defender cannot infer vuln from std-list-sandboxes). Modern base + vulnerable Bash 4.3 so it runs on WSL2/current kernels.
# Build: podman build -t agentron/red-vs-blue-target:latest .
# Run:  podman run -d -p 8080:80 --name red-blue-target agentron/red-vs-blue-target:latest

# --- Stage 1: build Bash 4.3 (pre-patch 25, vulnerable) ---
FROM debian:bookworm-slim AS bashbuilder
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    wget \
    ca-certificates \
    bison \
    gettext \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /build
RUN wget -q https://ftp.gnu.org/gnu/bash/bash-4.3.tar.gz && tar xzf bash-4.3.tar.gz
WORKDIR /build/bash-4.3
RUN ./configure --prefix=/usr/local && make -j$(nproc) && make install

# --- Stage 2: runtime image ---
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    apache2 \
    && a2enmod cgi \
    && a2enconf serve-cgi-bin \
    && rm -rf /var/lib/apt/lists/*
COPY --from=bashbuilder /usr/local/bin/bash /usr/local/bin/bash
COPY vulnerable /usr/lib/cgi-bin/vulnerable
RUN chmod 755 /usr/lib/cgi-bin/vulnerable
EXPOSE 80
CMD ["apache2ctl", "-DFOREGROUND"]
