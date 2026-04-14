group "default" {
  targets = ["probe"]
}

target "probe" {
  context = "./apps/probe-rs"
  dockerfile = "./apps/probe-rs/Dockerfile"
  platforms = ["linux/amd64"]
  tags = ["ghcr.io/your-org/webperf-probe:dev"]
}
