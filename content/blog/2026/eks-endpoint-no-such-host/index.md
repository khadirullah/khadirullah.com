---
title: "My new EKS cluster said no such host"
images: ["social-fallback.webp"]
date: 2026-11-11T01:40:00+05:30
draft: false
description: "A brand-new EKS endpoint failed to resolve right after terraform apply. The kubeconfig was fine. My VM's DNS resolver had cached an early no, and Google and Cloudflare already had the answer. Every command from the terminal, and how to check for it yourself."
summary: "kubectl said my brand-new EKS cluster's name did not exist. The kubeconfig was fine and AWS had the name. My own DNS resolver had asked too early and cached the no. Here is how I found it, step by step from the terminal, and how to check for it yourself."
tags: ["dns", "kubernetes", "aws", "eks", "linux", "troubleshooting"]
categories: ["Tutorials"]
slug: "eks-endpoint-no-such-host"
---

{{< lead >}}
The cluster was up and Terraform had printed its address, but kubectl said the name did not exist.
{{< /lead >}}

On 2026-10-28 I applied my
[EKS monitoring stack](/blog/terraform-eks-monitoring-live-run/) for the first time.
EKS is Kubernetes run by AWS. Terraform built 28 resources in about 13
minutes, including the EKS control plane, the part of Kubernetes that AWS runs
for you. Then the deploy script tried to install the monitoring stack with
kubectl, the Kubernetes command line tool, and failed.

This post is that failure, in the order it happened, with the commands and
output from my terminal. It ends with how to check for it yourself and how to
get past it.

## The error

Here is the end of the deploy script's output, as it came out. Steps 1 and 2
worked. Step 3 failed.

```text
aws_eks_node_group.main: Creation complete after 1m51s [id=eks-monitoring:eks-monitoring-nodes]
aws_eks_addon.coredns: Creating...
aws_eks_addon.coredns: Creation complete after 17s [id=eks-monitoring:coredns]

Apply complete! Resources: 28 added, 0 changed, 0 destroyed.

Outputs:

cluster_endpoint = "https://<cluster-id>.gr7.us-east-1.eks.amazonaws.com"
...
[ok] AWS infrastructure provisioned successfully
[->] Step 2/4: Configuring kubectl for EKS cluster...
Added new context arn:aws:eks:us-east-1:<account-id>:cluster/eks-monitoring to /home/<user>/.kube/config
[ok] kubectl configured for cluster: eks-monitoring
[->] Step 3/4: Deploying monitoring stack to Kubernetes...
error: error validating "k8s/monitoring/namespace.yaml": error validating data: failed to download openapi: Get "https://<cluster-id>.gr7.us-east-1.eks.amazonaws.com/openapi/v2?timeout=32s": dial tcp: lookup <cluster-id>.gr7.us-east-1.eks.amazonaws.com on 192.168.122.1:53: no such host; if you choose to ignore these errors, turn validation off with --validate=false
```

## Not the kubeconfig

My first thought was the kubeconfig. That's the file in `~/.kube/config` that
tells kubectl which cluster to talk to. Maybe it had not been written properly.

The output says otherwise. Step 2 ran `aws eks update-kubeconfig`, and its
"Added new context" line shows the file was written, one step before the
failure. The error also names the cluster's own address, which kubectl only
knows from the kubeconfig.

`update-kubeconfig` only talks to the AWS API, not to the cluster. Step 3's
`kubectl apply` was the first command that connected to the cluster's address.
So it was also the first time my VM looked that name up, about two minutes
after the control plane finished.

## A name that would not resolve

The failure is in the last part of the error, `lookup ... no such host`. My
machine could not turn the name into an IP address. `getent hosts` looks a name
up the same way kubectl does, so I tried it, again and again. These are three
of about ten tries.

```text
❯ getent hosts <cluster-id>.gr7.us-east-1.eks.amazonaws.com
[ble: exit 2]
❯ getent hosts <cluster-id>.gr7.us-east-1.eks.amazonaws.com
[ble: exit 2]
❯ getent hosts  https://<cluster-id>.gr7.us-east-1.eks.amazonaws.com
[ble: exit 2]
```

The `[ble: exit 2]` lines are my shell printing each command's exit code. For
`getent`, exit code 2 means the name was not found. The `https://` tries were never going
to work. `getent hosts` wants a name, and `https://...` is a URL.

## A workaround in `/etc/hosts`

Next I gave the system the answer myself. `/etc/hosts` holds lines of an IP and
a name, and the system reads it before asking DNS. I added the cluster's name
with 52.200.189.167, one of its real addresses, and the lookup worked.

```text
❯ echo "52.200.189.167 <cluster-id>.gr7.us-east-1.eks.amazonaws.com" | sudo tee -a /etc/hosts
[sudo] password for <user>:
52.200.189.167 <cluster-id>.gr7.us-east-1.eks.amazonaws.com
❯ getent hosts <cluster-id>.gr7.us-east-1.eks.amazonaws.com
52.200.189.167  <cluster-id>.gr7.us-east-1.eks.amazonaws.com
```

Then I removed the line again, to see whether DNS had caught up.
`sed -i '/text/d'` deletes every line that contains the text, so this takes
the line back out of `/etc/hosts`. Without it, the lookup went back to DNS, and
DNS still said no.

```text
❯ sudo sed -i '/<cluster-id>/d' /etc/hosts
❯ getent hosts <cluster-id>.gr7.us-east-1.eks.amazonaws.com
[ble: exit 2]
❯ getent hosts <cluster-id>.gr7.us-east-1.eks.amazonaws.com
[ble: exit 2]
❯ getent hosts <cluster-id>.gr7.us-east-1.eks.amazonaws.com
[ble: exit 2]
```

So I added the line back, and with it in place, ran Step 3 by hand.

```text
❯ echo "52.200.189.167 <cluster-id>.gr7.us-east-1.eks.amazonaws.com" | sudo tee -a /etc/hosts
52.200.189.167 <cluster-id>.gr7.us-east-1.eks.amazonaws.com
❯ kubectl apply -f k8s/monitoring/namespace.yaml
namespace/monitoring created
❯ kubectl apply -f k8s/monitoring/
configmap/alertmanager-config created
deployment.apps/alertmanager created
...
deployment.apps/prometheus created
service/prometheus created
❯ kubectl wait --for=condition=ready pod -l app.kubernetes.io/name=prometheus   -n monitoring --timeout=120s
pod/prometheus-7ff56f6d84-rxjpm condition met
❯ kubectl wait --for=condition=ready pod -l app.kubernetes.io/name=grafana      -n monitoring --timeout=120s
pod/grafana-f4995c66f-9n9kw condition met
❯ kubectl wait --for=condition=ready pod -l app.kubernetes.io/name=alertmanager -n monitoring --timeout=120s
pod/alertmanager-5bfd595d48-pqj7r condition met
```

The `...` stands for 17 more lines like the ones around it. The stack was running, but only
because of the line in `/etc/hosts`. I still did not know why DNS said no.

## Asking three resolvers

A resolver is the server your machine asks to turn a name into an IP address.
To see where the "no" came from, I asked three resolvers the same question.
First, which resolver does my VM use? Then the same lookup to my VM's resolver,
to Google's at 8.8.8.8 and to Cloudflare's at 1.1.1.1. For each one,
`dig +short` prints only the addresses, and the second command pulls out the
status line. `dig` skips `/etc/hosts` and asks the resolver directly, so
the line I added does not hide anything here.

```text
$ cat /etc/resolv.conf
nameserver 192.168.122.1

$ dig +short <cluster-endpoint>
$ dig <cluster-endpoint> | grep -o 'status: [A-Z]*'
status: NXDOMAIN

$ dig +short @8.8.8.8 <cluster-endpoint>
52.200.189.167
100.49.101.201
$ dig @8.8.8.8 <cluster-endpoint> | grep -o 'status: [A-Z]*'
status: NOERROR

$ dig +short @1.1.1.1 <cluster-endpoint>
100.49.101.201
52.200.189.167
$ dig @1.1.1.1 <cluster-endpoint> | grep -o 'status: [A-Z]*'
status: NOERROR
```

The system resolver was 192.168.122.1, my VM's own. It printed no address and
said NXDOMAIN, which is a resolver's way of saying "this name does not exist".
Google and Cloudflare both returned the same two addresses, and NOERROR means
the lookup worked. Only my resolver said the name did not exist.

The two addresses are two ways in to the same cluster. AWS runs at least two
API server instances for every cluster, spread across availability zones,
according to the
[EKS architecture docs](https://docs.aws.amazon.com/eks/latest/userguide/eks-architecture.html).
A client like kubectl picks one address, and can use the other if the first
does not answer. Google and Cloudflare listed them in a different order, and
the order does not matter.

## Negative caching

We ran kubectl too early, before AWS had published the cluster's name. My
resolver got "no such name" and remembered it.

That's called negative caching. A resolver keeps a "no" for a while, the same
way it keeps a "yes". Think of calling a shop to ask about an item. They say
no, so you write "no" on a note. Ten minutes later the item arrives, but you
don't call again, because your note says no. Google and Cloudflare had never
been asked that early. They had no old note, so they gave the real addresses.

Here is the same story for my VM's resolver, in order.

{{< mermaid >}}
sequenceDiagram
    participant me as My terminal<br/>kubectl and dig
    participant vm as My VM's resolver<br/>192.168.122.1
    participant up as DNS servers<br/>on the internet
    me->>vm: Where is the cluster's name?
    vm->>up: Where is the cluster's name?
    up-->>vm: No such name yet
    Note over vm: Keeps the #quot;no#quot; for a while
    vm-->>me: NXDOMAIN
    Note over up: AWS publishes the name
    me->>vm: Where is the cluster's name?
    vm-->>me: NXDOMAIN, from its cache
    Note over vm: The #quot;no#quot; expires
    me->>vm: Four minutes later, the same question
    vm->>up: Where is the cluster's name?
    up-->>vm: 52.200.189.167 and 100.49.101.201
    vm-->>me: 52.200.189.167 and 100.49.101.201
{{< /mermaid >}}

## Four minutes later

When I asked again four minutes later, my own resolver had the answer too.

```text
$ dig +short <cluster-endpoint>
52.200.189.167
100.49.101.201
$ dig <cluster-endpoint> | grep -o 'status: [A-Z]*'
status: NOERROR
```

The note had expired, so my resolver looked the name up again and got the
real addresses.

## Why the `/etc/hosts` line won

One question was still open. DNS was still saying no. So why did the line in
`/etc/hosts` work?

The answer is the lookup order. Linux keeps it in `/etc/nsswitch.conf`.

```text
$ grep '^hosts:' /etc/nsswitch.conf
hosts:          files mdns4_minimal [NOTFOUND=return] dns
```

kubectl reads this same list and tries the sources from left to right. It
stops at the first one that answers.

1. `files` is `/etc/hosts`. If the name is there, that is the answer. Nothing
   else is asked.
2. `mdns4_minimal` is only for names ending in `.local`, like `printer.local`
   on a home network. The cluster's name does not end in `.local`, so this step
   does nothing for it. `[NOTFOUND=return]` only applies to `.local` names too.
3. `dns` is the resolver named in `/etc/resolv.conf`. On my VM that is
   192.168.122.1.

The cached "no" lived in step 3, inside the resolver.

With the line in `/etc/hosts`, step 1 found the name. Linux stopped there, so
it never asked the resolver.

Without the line, steps 1 and 2 found nothing. Step 3 asked the resolver, and
the resolver answered from its cache, "no such name".

`dig` works differently. It does not use this list. It skips `/etc/hosts` and
always asks the resolver. So while the line was in place, the two tools gave
different answers.

{{< mermaid >}}
---
config:
  flowchart:
    wrappingWidth: 260
---
flowchart TB
    kubectl["kubectl"]
    dig["dig"]
    files["1. files<br/>/etc/hosts"]
    mdns["2. mdns4_minimal<br/>only .local names"]
    dns["3. dns<br/>my VM's resolver<br/>192.168.122.1"]
    found["IP address from /etc/hosts<br/>kubectl connects"]
    nx["cached #quot;no#quot;<br/>dig shows NXDOMAIN<br/>kubectl shows no such host"]
    kubectl --> files
    files -- "line is there" --> found
    files -- "line is gone" --> mdns
    mdns -- "not a .local name" --> dns
    dig -- "skips the list" --> dns
    dns --> nx
{{< /mermaid >}}

With DNS answering on its own, I removed the line for good, and kubectl kept
working without it.

```text
❯ sudo sed -i '/<cluster-id>/d' /etc/hosts
❯ kubectl get nodes
NAME                         STATUS   ROLES    AGE   VERSION
ip-10-0-1-10.ec2.internal    Ready    <none>   15m   v1.35.9-eks-577a51e
ip-10-0-2-242.ec2.internal   Ready    <none>   15m   v1.35.9-eks-577a51e
```

## The second run

On the second run the same script went straight through Step 3.

```text
[->] Step 2/4: Configuring kubectl for EKS cluster...
Added new context arn:aws:eks:us-east-1:<account-id>:cluster/eks-monitoring to /home/<user>/.kube/config
[ok] kubectl configured for cluster: eks-monitoring
[->] Step 3/4: Deploying monitoring stack to Kubernetes...
namespace/monitoring created
configmap/alertmanager-config created
...
```

So this is a race, not a bug in the script. It depends on whether your first
lookup lands before AWS publishes the name.

## If this happens to you

Check first, then wait. These three commands ask the same question, one
resolver each.

```bash
dig +short <cluster-endpoint>             # your own resolver
dig +short @8.8.8.8 <cluster-endpoint>    # Google
dig +short @1.1.1.1 <cluster-endpoint>    # Cloudflare
```

`+short` prints only the addresses. A name that does not resolve prints
nothing. If Google and Cloudflare print addresses and your own resolver prints
nothing, your resolver is holding a cached "no". Run the first command again
after a few minutes. Once it prints the addresses, kubectl works too.

If you cannot wait, use `/etc/hosts` for a few minutes. Here it is with a
made-up endpoint, `ABCD1234EXAMPLE.gr7.us-east-1.eks.amazonaws.com`. Use your
own from the error message.

```bash
$ dig +short @8.8.8.8 ABCD1234EXAMPLE.gr7.us-east-1.eks.amazonaws.com
52.200.189.167
100.49.101.201
```

Add one line, the IP first and the name after it. `tee -a` adds it to the end
of the file, and `sudo` is needed because only root can write there.

```bash
echo "52.200.189.167 ABCD1234EXAMPLE.gr7.us-east-1.eks.amazonaws.com" | sudo tee -a /etc/hosts
```

The file now ends with that line.

```text
::1     localhost ip6-localhost ip6-loopback
ff02::1 ip6-allnodes
ff02::2 ip6-allrouters
52.200.189.167 ABCD1234EXAMPLE.gr7.us-east-1.eks.amazonaws.com
```

The first three lines come with the OS, and yours may look different. Only the
last one is new.

Check it with `getent hosts`.

```bash
$ getent hosts ABCD1234EXAMPLE.gr7.us-east-1.eks.amazonaws.com
52.200.189.167  ABCD1234EXAMPLE.gr7.us-east-1.eks.amazonaws.com
```

When `dig +short` against your own resolver prints the addresses, remove the
line. `sed -i '/text/d'` deletes every line that contains the text, so the
cluster ID part is enough.

```bash
sudo sed -i '/ABCD1234EXAMPLE/d' /etc/hosts
```

Don't leave it in. The line pins an IP that AWS is free to change, and the day
it changes, kubectl breaks with no clue why.

{{< alert icon="lightbulb" cardColor="#1a2e1a" iconColor="#4ade80" textColor="#86efac" >}}
If the name never resolves anywhere, not even on Google or Cloudflare, the cluster's endpoint may not be ready yet. If it resolves on the public resolvers but never on yours, check for DNS filtering on your network, such as AdGuard Home on the router or a firewall.
{{< /alert >}}

## What I took from it

- A brand-new DNS name can be cached as missing if you ask for it too early.
- Ask a public resolver with `dig @8.8.8.8 <name>` before debugging anything
  else.
- An `/etc/hosts` line gets you past it, but take it out once DNS catches up.

The rest of the run, with two failures caused on purpose and three bugs, is in
[I ran my EKS monitoring stack and broke it on purpose](/blog/terraform-eks-monitoring-live-run/).
