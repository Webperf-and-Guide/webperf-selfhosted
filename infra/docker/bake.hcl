group "default" {
  targets = ["probe"]
}

target "probe" {
  context = "."
  dockerfile = "./apps/probe-rs/Dockerfile"
  platforms = ["linux/amd64"]
  tags = ["ghcr.io/webperf-and-guide/webperf-probe:dev"]
}

target "browser-audit-worker" {
  context = "."
  dockerfile = "./apps/browser-audit-worker/Dockerfile"
  platforms = ["linux/amd64"]
  tags = ["ghcr.io/webperf-and-guide/webperf-browser-audit-worker:dev"]
}
