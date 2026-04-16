# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO

output "vm_host" {
  description = "Public IP address of the k3s VM"
  value       = local.vm_ip
  sensitive   = false
}

locals {
  vm_ip = [for ip in cherryservers_server.k3s.ip_addresses : ip.address if ip.type == "primary-ip"][0]
}

output "kubeconfig_command" {
  description = "Command to fetch kubeconfig from the k3s VM"
  value       = "ssh root@${local.vm_ip} cat /etc/rancher/k3s/k3s.yaml"
  sensitive   = false
}
