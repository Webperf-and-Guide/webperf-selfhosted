group "default" {
  targets = ["probe"]
}

target "probe" {
  context = "."
  dockerfile = "./apps/probe-rs/Dockerfile"
  platforms = ["linux/amd64"]
  tags = ["ghcr.io/webperf-and-guide/webperf-probe:dev"]
}

target "browser-audit-lighthouse" {
  context = "."
  dockerfile = "./apps/browser-audit-lighthouse/Dockerfile"
  platforms = ["linux/amd64"]
  tags = ["ghcr.io/webperf-and-guide/webperf-browser-audit-lighthouse:dev"]
}
