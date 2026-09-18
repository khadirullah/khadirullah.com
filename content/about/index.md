---
title: "About"
description: "About Khadirullah Mohammad, DevOps & Cloud Engineer"
showDate: false
showReadingTime: false
showAuthor: false
showPagination: false
showTableOfContents: true
---

## Hey, I'm Khadirullah 👋

{{< lead >}}
DevOps & Cloud Engineer with 4+ years of professional IT experience and a B.Tech in Computer Science.
I build CI/CD pipelines, manage cloud infrastructure on AWS, and automate deployments using Docker, Kubernetes, and Terraform. Recently built a 3-node Kubernetes cluster that comes up from a single `terraform apply`, and an AI-powered incident correlation tool that JOINs data across GitHub, Sentry, and Slack using cross-source SQL.
{{< /lead >}}

---

## My Journey

{{< timeline >}}

{{< timelineItem icon="code" header="Hands-On IT Work" badge="Where It Started" >}}
Assembling PCs, installing operating systems, configuring routers, optimizing WiFi networks, and setting up CCTV systems. I was the go-to person for anything hardware or networking related.
{{< /timelineItem >}}

{{< timelineItem icon="graduation-cap" header="B.Tech in Computer Science" badge="2022" >}}
Graduated from Andhra University. Explored full-stack development but realized I enjoyed the infrastructure side more than building web applications.
{{< /timelineItem >}}

{{< timelineItem icon="shield" header="Engineer (Programmer, Network & System Admin)" badge="Jul 2019 – Nov 2023 · 4y 5m" >}}
Sole engineer running end-to-end IT operations for the organization. Workstation provisioning, network administration, a company-wide Windows to Linux migration, OpenWRT router firmware, hardware maintenance, and CCTV.
{{< /timelineItem >}}

{{< timelineItem icon="cloud" header="DevOps & Cloud Engineering" badge="Dec 2023 – Present" >}}
Building CI/CD pipelines with Jenkins and GitHub Actions, provisioning Kubernetes clusters with Terraform and kubeadm, writing infrastructure as code for AWS, and working towards AWS certifications.
{{< /timelineItem >}}

{{< /timeline >}}

---

## Skills

<span class="text-2xl">{{< icon "cloud" >}}</span> **Cloud & Infrastructure**
- AWS: EC2, VPC, subnets, security groups, ELB, EKS, S3, IAM, Route 53, CloudWatch
- Terraform: modular infrastructure as code, variables, outputs, state
- Ansible: configuration management and playbooks

<span class="text-2xl">{{< icon "docker" >}}</span> **Containers & Orchestration**
- Docker: Dockerfiles, custom images, multi-stage builds, Docker Compose
- Kubernetes: Deployments, Services, RBAC, NetworkPolicies, Ingress, SecurityContexts
- Cluster provisioning: kubeadm, kops

<span class="text-2xl">{{< icon "git" >}}</span> **CI/CD & Tooling**
- Jenkins: pipelines with SonarQube, Trivy, Docker, and Kubernetes integration
- GitHub Actions: automated testing, publishing, and deployment
- Git, Maven, Gradle, npm, Bash scripting

<span class="text-2xl">{{< icon "linux" >}}</span> **Systems & Networking**
- Linux: administration, systemd, networking, troubleshooting
- Virtualisation: QEMU/KVM and libvirt
- DNS: SPF, DKIM, DMARC configuration
- Networking: router configuration, OpenWRT, WiFi optimization, TCP/IP, iptables

🐍 **Scripting & Automation**
- Python: API integration, automation scripts, Flask
- SQL: cross-source queries with Coral for incident correlation
- Bash: system administration and deployment automation

🔒 **Monitoring & Security**
- Sentry: error tracking and incident monitoring
- Slack: incident alerting and team notifications
- Coral SQL: cross-source API queries (GitHub + Sentry + Slack)
- Fernet AES encryption, SSL/TLS, IAM, Cloudflare
- Currently building: Prometheus, Grafana, and AlertManager on my local cluster, with alerts routed to Slack

---

## Projects

### ☸️ Local Kubernetes Cluster with Terraform

A 3-node kubeadm cluster on QEMU/KVM that comes up from a single `terraform apply`. The Terraform libvirt provider creates the VMs, cloud-init installs containerd and kubeadm, Calico runs as the CNI through the Tigera operator, and workers fetch the join token over HTTP, so the build never needs SSH. Roughly 7 minutes from nothing to a ready cluster.

Minikube and Kind hide the parts worth learning. This gives real multi-node topology, real VM networking, and actual kubeadm experience, which is the same provisioning workflow used in production.

**Tech:** Terraform, Libvirt, QEMU/KVM, Kubernetes, kubeadm, Calico, Cloud-Init, Bash

{{< github repo="khadirullah/local-k8s-terraform" >}}

[Read the full write-up](/blog/local-k8s-terraform-cluster/)

---

### 🔍 DevOps Incident Investigator
*Hackathon: Pirates of the Coral-bean (WeMakeDevs, May 2026), Top 50 showcase project*

An AI-powered incident correlation tool that JOINs data from GitHub PRs, Sentry errors, and Slack messages using cross-source SQL via Coral, so the whole picture sits in one view instead of five browser tabs. Features a web dashboard with real-time incident timeline, Gemini AI root-cause analysis, one-click Slack alerting, natural-language-to-SQL queries, and encrypted token management.

**Tech:** Python, Flask, Coral SQL, Gemini 2.0 Flash, Docker, GitHub Actions, Slack API, Sentry API

{{< github repo="khadirullah/devops-incident-investigator" >}}

---

### CI/CD Pipelines

Built end-to-end Jenkins pipelines:

`code commit` → `static analysis (SonarQube)` → `Docker build` → `vulnerability scanning (Trivy)` → `push to registry` → `deploy on Kubernetes with AWS ELB`

### Kubernetes Workloads

Deployments, ReplicaSets, Services (ClusterIP, NodePort, LoadBalancer), NGINX Ingress, ingress and egress NetworkPolicies, certificate-based users with verb-level RBAC, and capability control through SecurityContext.

### Infrastructure as Code

Provisioned AWS infrastructure using Terraform: VPCs with public and private subnets, EC2 instances, security groups, IAM roles, S3 buckets, load balancers, and Route 53 records.

---

### DiagView

A lightweight interactive SVG/Mermaid diagram viewer with search, export, and deep linking. Published to npm at v1.0.12 with 342 tests and fully automated CI/CD.

{{< github repo="khadirullah/diagview" >}}

### This Website

Hugo + Blowfish theme, deployed on Cloudflare Pages with custom domain, DNS records, and email authentication (SPF/DKIM/DMARC). → [khadirullah.com](https://khadirullah.com)

{{< github repo="khadirullah/khadirullah.com" >}}

---

## Get In Touch

{{< alert "email" >}}
I'm actively looking for **DevOps Engineer**, **Cloud Engineer**, and **Linux System Administrator** roles in **Hyderabad**, **Bangalore**, or **remote**. Immediate joiner.
{{< /alert >}}

- {{< icon "email" >}} **Email:** [contact@khadirullah.com](mailto:contact@khadirullah.com)
- {{< icon "github" >}} **GitHub:** [github.com/khadirullah](https://github.com/khadirullah)
- {{< icon "linkedin" >}} **LinkedIn:** [linkedin.com/in/khadirullah](https://linkedin.com/in/khadirullah)
- {{< icon "x-twitter" >}} **X (Twitter):** [x.com/khadirullah_](https://x.com/khadirullah_)
- 📄 **Resume:** [View Resume](/resume/)

{{< button href="mailto:contact@khadirullah.com" >}}
{{< icon "email" >}} &nbsp; Contact Me
{{< /button >}}
