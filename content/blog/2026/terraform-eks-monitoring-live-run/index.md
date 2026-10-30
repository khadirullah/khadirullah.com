---
title: "I ran my EKS monitoring stack and broke it on purpose"
images: ["social-fallback.webp"]
date: 2026-10-28
draft: true
description: "Applying a Terraform EKS cluster with Prometheus, Grafana and Alertmanager for the first time, crashing a pod and stopping a node's kubelet to prove the alerts fire, and the three bugs that terraform validate never caught."
summary: "My EKS monitoring repo had passed terraform validate for weeks and had never been applied. I applied it, crashed a pod, stopped a node's kubelet, and watched what the alerts did. It found three bugs, and one of them was an alert that switches itself off while the pod is still broken. A second run proved the fixes."
tags: ["project", "kubernetes", "aws", "eks", "terraform", "prometheus", "grafana", "alertmanager", "monitoring", "devops"]
categories: ["Projects"]
slug: "terraform-eks-monitoring-live-run"
---

{{< lead >}}
Twenty-eight resources, two deliberate failures, and three bugs that only showed up once the cluster was real.
{{< /lead >}}

I wanted a blueprint. One setup I can bring up on AWS, deploy my apps to, and
see them in monitoring from the first minute. A base to practise on, so a new
app goes onto a ready cluster instead of a fresh build every time.

That blueprint is
[terraform-eks-monitoring](https://github.com/khadirullah/terraform-eks-monitoring).
For weeks its README said the same thing at the top. `terraform validate`
passes, every manifest parses, not yet applied against a live AWS account.

`terraform validate` checks that the code is well formed. It never creates
anything. So it cannot tell you whether an alert fires when something breaks.
Until the repo ran on real AWS, it was a claim, not a fact.

So I applied it, checked every piece, broke it twice on purpose, and tore it
down. Then I fixed what it found and applied it a second time to check the
fixes. The first run was on 2026-10-28. This post is what happened, in order,
including the parts that went wrong.

## What the stack is

Terraform is a tool that creates cloud resources from code. You describe what
you want in `.tf` files, and `terraform apply` builds it.

It builds the network first. That's a VPC, a private network of your own inside
AWS. The VPC has four subnets, two public and two private, spread over two
availability zones. An availability zone is a separate data centre, so losing
one doesn't take everything down.

The worker nodes sit in the private subnets, with no public address. They still
need the internet to pull container images. A NAT gateway handles that. It lets
traffic out of the private subnets and stops anything from coming in.

Then comes EKS 1.35, which is Kubernetes run by AWS. AWS runs the control plane,
the part of Kubernetes that makes the decisions. My nodes run the pods. They
come from a managed node group, which is a set of EC2 machines that EKS creates
and looks after.

1.35 is not the newest version. On October&nbsp;30,&nbsp;2026, the
[EKS version list](https://docs.aws.amazon.com/eks/latest/userguide/kubernetes-versions.html)
had 1.36 and 1.37 in standard support too. I use the older one on purpose.
Upgrading a cluster is a skill of its own, and the next post will take this
cluster up a version, the way you would in a real job. 1.35 stays in standard
support until March&nbsp;27,&nbsp;2027, so there is time.

I wrote every resource by hand as an `aws_*` block instead of using a community
module. That way every role and route table is in the code where you can read
it.

The monitoring runs on the cluster, from hand-written manifests. A manifest is
a YAML file that tells Kubernetes what to run. I didn't use the
kube-prometheus-stack Helm chart, so every piece is in a file of its own.

- **Prometheus 3.14** collects metrics. Every 15 seconds it fetches numbers from
  each source over HTTP, which is called scraping. It also checks the alert
  rules.
- **kube-state-metrics** turns Kubernetes objects into metrics, such as how many
  times a pod restarted.
- **node-exporter** runs on every node and reports its CPU, memory and disk.
- **Alertmanager** gets the alerts that fire and sends them on. Critical alerts
  go to one Slack receiver and warnings to another.
- **Grafana 13** draws graphs from what Prometheus stored. It ships with no
  dashboards, so every graph in this post comes from Explore, the Grafana page
  where you run one query at a time.

{{< mermaid >}}
graph LR
    subgraph node ["each worker node"]
        kubelet["kubelet and cAdvisor<br/>container metrics"]
        nodeexp["node-exporter<br/>CPU, memory, disk"]
    end
    api["EKS API server"]
    ksm["kube-state-metrics<br/>pods, nodes, restarts"]
    prom["Prometheus<br/>scrape and evaluate every 15 seconds"]
    am["Alertmanager<br/>route by severity"]
    slack["Slack"]
    grafana["Grafana<br/>Explore"]
    api --> ksm
    kubelet --> prom
    nodeexp --> prom
    ksm --> prom
    api --> prom
    prom -- "firing alerts" --> am
    am --> slack
    prom --> grafana
{{< /mermaid >}}

The repo defaults to two t3.medium nodes. I ran it on two t3.small, the
smallest setup that holds this stack. One t3.small fits the memory requests on
paper, but not the limits. With one node you also cannot test a dead node,
because Prometheus dies with it.

For this test I left `public_access_cidrs` at its default. That meant the
cluster's API endpoint, the address kubectl talks to, accepted connections from
any address. Every request still needed IAM credentials. For testing it is open
to all traffic. We never do that in production.

In production everything stays private. The only public part is the load
balancer that users connect to. Secrets, such as the Slack webhook, go into a
store like AWS Secrets Manager. Pods get AWS permissions through service
accounts, not stored keys. The repo has the first piece of that already.
`irsa.tf` registers the cluster with IAM, so that a Kubernetes service account
can take an IAM role. No pod uses one yet.

{{< alert icon="triangle-exclamation" >}}
This stack costs about $0.20 an hour while it runs, and nothing stops the bill
for you. If you plan to follow along, read
<a href="#before-you-try-this-yourself">Before you try this yourself</a> first,
and destroy the same day.
{{< /alert >}}

## The apply, and a DNS name that did not exist yet

The plan said 28 to add. IAM roles finished in two seconds, the network in
about half a minute, and the NAT gateway in 1 minute 39 seconds. The control
plane took 10 minutes 15 seconds on "Still creating...", which is normal for
EKS. The node group needed another 1 minute 51 seconds after that. The whole apply took about 13 minutes.

Then the deploy script's first kubectl call failed.

```text
[->] Step 3/4: Deploying monitoring stack to Kubernetes...
error: error validating "k8s/monitoring/namespace.yaml": ... dial tcp: lookup <cluster-id>.gr7.us-east-1.eks.amazonaws.com on 192.168.122.1:53: no such host
```

The cluster was up, but my VM could not turn its address into an IP. kubectl
asked for the name about two minutes after the control plane finished, before
AWS had published it. My VM's DNS resolver got "no such name" and kept that
answer in its cache for a few minutes. When I checked, Google's and
Cloudflare's resolvers already had the real addresses.

A line in `/etc/hosts` got me past it, and I removed the line once the cache
expired. On the second run the same script went straight through, so it is a
race, not a bug in the script.

The full story, with every command and how to check for it yourself, is in
[My new EKS cluster said no such host](/blog/eks-endpoint-no-such-host/).

## What EKS builds that Terraform never wrote

The AWS console shows a few things that are not in any `.tf` file. The node
group is the first. `aws_eks_node_group` never mentions EC2 Auto Scaling. But
that is what EKS creates underneath it. An Auto Scaling group keeps a set
number of EC2 machines running, using the min, max and desired sizes from my
variables.

{{< figure src="media/node-group-asg.webp" alt="EC2 Auto Scaling groups page with one group named eks-eks-monitoring-nodes, at desired capacity, 2 of 2 healthy, desired 2, min 1, max 2" caption="The managed node group is an Auto Scaling group that EKS owns. Terraform only declared the node group." >}}

The security groups are the second. A security group is a firewall that AWS
puts in front of a machine or a network interface. Terraform made one for the
control plane. It allows HTTPS on 443 from inside the VPC and nothing else.

{{< figure src="media/sg-terraform.webp" alt="Security group eks-monitoring-cluster-sg with one inbound rule, HTTPS on TCP 443 from 10.0.0.0/16" caption="The security group Terraform made. One inbound rule, 443 from the VPC range." >}}

EKS made another one by itself, named `eks-cluster-sg-eks-monitoring-...`. Its
only inbound rule allows all traffic from members of the same group. The
[EKS security group docs](https://docs.aws.amazon.com/eks/latest/userguide/sec-group-reqs.html)
say EKS attaches it to the 2 to 4 network interfaces it creates for the
control plane, and to the nodes of every managed node group. My screenshots
show the group and its rule, not where it was attached, so that part comes
from the docs.

That rule is what lets the nodes, the control plane and the pods talk to each
other. The 443 rule above would not be enough on its own. The API server also
connects to the kubelet on each node on port 10250, for things like
`kubectl logs` and `kubectl exec`. The kubelet is the Kubernetes agent on each
node that starts the containers and reports back. The same EKS page lists both
ports.

A security group sits on each network interface, not on a subnet, so the rule
works across subnets. My two nodes were in different private subnets, one in
us-east-1a and one in us-east-1b. Prometheus runs as one pod on one of them
and scrapes node-exporter on both, on port 9100. One of those scrapes always
crosses to the other subnet, and both node-exporter targets were UP in the
first run. A machine in the same VPC without this group gets nothing from this
rule. The
[VPC docs on security group referencing](https://docs.aws.amazon.com/vpc/latest/userguide/security-group-rules.html#security-group-referencing)
explain how a rule with a group as its source works.

{{< mermaid >}}
---
config:
  flowchart:
    wrappingWidth: 200
---
flowchart TB
    subgraph vpc["VPC 10.0.0.0/16"]
        cp["Control plane<br/>network interfaces<br/>carry eks-cluster-sg"]
        subgraph subA["Private subnet, us-east-1a"]
            nodeA["Node A<br/>carries eks-cluster-sg<br/>Prometheus pod"]
        end
        subgraph subB["Private subnet, us-east-1b"]
            nodeB["Node B<br/>carries eks-cluster-sg<br/>node-exporter on 9100<br/>kubelet on 10250"]
        end
        other["Any machine<br/>without eks-cluster-sg"]
    end
    nodeA -->|"9100, allowed"| nodeB
    cp -->|"10250, allowed"| nodeB
    other -.-x|"blocked"| nodeB
{{< /mermaid >}}

The two solid lines worked in both runs. Every `kubectl port-forward` I ran
took the 10250 path. The dashed line is what the rule means for a machine
without the group. I did not test that one.

{{< figure src="media/sg-eks-created.webp" alt="Security group list with eks-cluster-sg-eks-monitoring selected, its one inbound rule allowing all traffic from the same security group" caption="The security group EKS created on its own. All traffic, but only from members of the same group." >}}

If you ever write firewall rules for an EKS cluster by hand, look at this group
first. Most of what you need already exists there.

## Proving it works before breaking it

The first check was Prometheus' target page. A target is one address that
Prometheus scrapes, and UP means the last scrape worked. There were ten
targets, all UP:

- the API server, through two endpoints
- the kubelet and cAdvisor on each node
- node-exporter on each node
- kube-state-metrics
- Prometheus itself

cAdvisor is built into the kubelet and reports each container's CPU and
memory. Prometheus scrapes it on a separate path, so it counts as its own
target. The Grafana memory graphs in Bug 2 come from it.

One scrape pool was empty. It is for pods that opt in with annotations, and
nothing in the stack opts in.

{{< figure src="media/targets-up.webp" alt="Prometheus target health page: kube-state-metrics 1 of 1 up, kubernetes-apiservers 2 of 2 up" caption="The top of the target page. The list carries on with the kubelet, cAdvisor and node-exporter on both nodes, all UP." >}}

Grafana came up with Prometheus already set as its data source, and it worked.
The `up` query in Explore drew ten lines at 1. `up` is a metric Prometheus
records for every target, 1 when the scrape works and 0 when it fails.

The labels on those lines said `instance_type="t3.small"` and `us-east-1`.
Both are AWS names, so the data came from the EKS cluster. If you also run
Kubernetes on your own computer, with a tool such as kind or minikube, check
these labels before you trust a graph. A cluster on your computer would not
show `t3.small` or `us-east-1`. With two clusters, a port-forward can land on
the wrong Grafana.

{{< figure src="media/grafana-explore-up.webp" alt="Grafana Explore with the up query, a flat line at 1 starting when the pods came up, and a legend of t3.small node series" caption="The up query in Grafana Explore. Every line sits at 1 from the moment the pods started." >}}

Ten UP targets prove scraping works. They do not prove alerting works. For
that, something has to break.

## Breaking it once, with a pod that crashes

```bash
kubectl run crashtest --image=busybox -- sh -c "exit 1"
```

The container exits straight away. Kubernetes restarts it, and it exits again.
Each time, Kubernetes waits longer before the next restart. This is called
back-off. The wait starts at 10 seconds, then goes 20, 40, 80, 160, and stops
growing at 5 minutes.

The waits protect the node. Restarting a broken container hundreds of times a
minute would use up the node's time, and most crashes need something outside to change
first anyway, like a database coming back. Short waits at the start catch a
quick glitch. Longer waits stop a real breakage from wasting the node. The
5 minute cap means that once the cause is fixed, the pod recovers within 5
minutes on its own. After 10 minutes of running without a crash, the wait goes
back to 10 seconds. The
[Kubernetes Pod lifecycle docs](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#container-restarts)
cover the details.

After a few rounds the pod sits in CrashLoopBackOff. That's the state
Kubernetes shows while it waits to restart a container that keeps crashing.

kube-state-metrics counts the restarts. Graphing that count shows the steps
getting further apart.

{{< figure src="media/restarts-steps.webp" alt="Prometheus graph of kube_pod_container_status_restarts_total for crashtest climbing in steps from 1 to 6, each step wider than the last" caption="Restarts climbing from 1 to 6. Each flat stretch is longer than the one before, because of the back-off." >}}

To read it, time runs left to right, about 30 minutes across, and the left
side is the restart count. Each vertical jump is one restart, the count going
up by 1. Each flat stretch is the wait before the next restart, while the pod
sits in CrashLoopBackOff. The jumps lean a little instead of standing straight,
because Prometheus only checks every 15 seconds and draws a line between two
checks. The last flat stretch is the longest, because by then the wait was
close to its 5 minute cap.

The alert rule at the time was this.

```text
increase(kube_pod_container_status_restarts_total[15m]) > 5
```

In words, fire when the pod restarted more than 5 times in the last 15 minutes.
An alert in Prometheus is inactive, then pending while it waits out its `for`
time, then firing. This rule had `for: 0m`, so it skipped pending and went to
firing at the sixth restart, five and a half minutes after the pod started. Alertmanager received it under the
`slack-critical` receiver.

{{< figure src="media/am-crashloop.webp" alt="Alertmanager UI showing PodCrashLooping for pod crashtest under the slack-critical receiver" caption="The alert in Alertmanager, routed by its critical severity." >}}

Delivery to Slack failed every ten seconds with "Notify for alerts failed". I
expected that. The repo ships a placeholder webhook, and I had not added a real
one. Everything up to the hand-off to Slack worked.

```bash
kubectl logs -n monitoring \
  deploy/alertmanager --since=10m \
  | grep "Notify" | tail -3
```

```text
time=2026-10-28T13:01:40.404Z level=ERROR source=dispatch.go:589 msg="Notify for alerts failed" component=dispatcher ...
time=2026-10-28T13:01:50.402Z level=ERROR source=dispatch.go:589 msg="Notify for alerts failed" component=dispatcher ...
time=2026-10-28T13:02:00.419Z level=ERROR source=dispatch.go:589 msg="Notify for alerts failed" component=dispatcher ...
```

I cut each line after `component=dispatcher`. The rest names the alert,
PodCrashLooping, and the slack-critical receiver.

## Bug 1, the alert that switches itself off

I left the pod crashing and kept watching. Ten and a half minutes after it
started firing, PodCrashLooping went back to inactive. The pod had not
recovered. `kubectl get pod` still said CrashLoopBackOff.

{{< figure src="media/alert-goes-quiet.webp" alt="Graph of the restart increase over 15 minutes rising above 5, staying there about ten minutes, then falling to 3 and below while the pod is still crashing" caption="The value the rule checks. It crosses 5, then falls back to 3 and below, while the pod keeps crashing the whole time." >}}

The rule fires when a pod restarts more than 5 times in 15 minutes. It does
that the first time. After that, there are no longer that many restarts inside
15 minutes, so it stops firing. But the pod is still broken. In production,
nobody would be told until a user reported the problem.

The back-off is why. At the start, restarts come seconds apart, so six of them
fit inside 15 minutes. Once the wait reaches 5 minutes, only about three fit.
Three is not more than five. So the alert fires in the first few minutes of a
crash loop. Then it goes quiet for as long as the pod stays broken.

Two and a half minutes after the alert cleared, at 18:43 IST, I asked
Prometheus two questions, one at a time.

**How many restarts in the last 15 minutes?**

```text
increase(
  kube_pod_container_status_restarts_total{
    pod="crashtest"
  }[15m]
)
```

It returned 3.05. That is the line in the graph above at 13:13 UTC, which is
18:43 IST, near its right edge.

`increase()` gives 3.05 rather than 3 because it estimates. It takes the
samples it has and stretches the result to cover the full 15 minutes, so it
rarely lands on a whole number. Read it as about three restarts.

**Is the pod waiting right now, and why?**

```text
kube_pod_container_status_waiting_reason{pod="crashtest"} == 1
```

It returned 1, with the label `reason="CrashLoopBackOff"`.

The restart count said "fine", and the second query said the pod was still
broken.

The fix is to stop counting restarts and ask a better question. Is the pod in
CrashLoopBackOff or not?

A plain `for: 5m` on that question is not enough. That rule would be
`kube_pod_container_status_waiting_reason{reason="CrashLoopBackOff"} == 1`
with `for: 5m`, and I never deployed it, because the run 2 numbers below show
it could not work. After each restart the container exits straight away and is
not waiting for a while, so the CrashLoopBackOff series disappears. A missing
series resets the `for` timer. At the 5 minute cap there is a gap like that
every 5 minutes, so the state never lasts five unbroken minutes, and the alert
would never fire. The kubernetes-mixin rule broke the same way in 2021, and its
maintainers
[switched to `max_over_time`](https://github.com/kubernetes-sigs/kubernetes-mixin/issues/645)
to fix it.

`max_over_time(...[5m])` bridges the gaps. It returns 1 if the pod was in
CrashLoopBackOff at any point in the last 5 minutes.

```yaml
- alert: PodCrashLooping
  expr: max_over_time(kube_pod_container_status_waiting_reason{reason="CrashLoopBackOff"}[5m]) >= 1
  for: 5m
```

This is the same shape as the KubePodCrashLooping rule in
[kubernetes-mixin](https://github.com/kubernetes-sigs/kubernetes-mixin/blob/master/alerts/apps_alerts.libsonnet),
which waits 15 minutes instead of 5.

I tested it on the second run with the same busybox pod and left it crashing
for half an hour. A small loop wrote down one line about once a minute:

- `alert=` is the alert's state in Prometheus, inactive, pending or firing.
- `crashtest=[...]` is the pod's restart count, then the reason it was waiting,
  from `kubectl get pod`.
- `grafana_restarts=` is Grafana's restart count, to check the Bug 2 fix at the
  same time.

This is the loop.

```bash
# Written with help from Claude (AI) during the run.
# Needs a port-forward to Prometheus first:
#   kubectl port-forward -n monitoring svc/prometheus 19090:9090

# PodCrashLooping's state, from the Prometheus rules API
alert_state() {
  curl -s 'localhost:19090/api/v1/rules?type=alert' | python3 -c '
import json, sys
for group in json.load(sys.stdin)["data"]["groups"]:
    for rule in group["rules"]:
        if rule["name"] == "PodCrashLooping":
            print(rule["state"])
' 2>/dev/null
}

# The crashing pod's restart count and waiting reason
crashtest_status() {
  kubectl get pod crashtest \
    -o jsonpath='{.status.containerStatuses[0].restartCount} {.status.containerStatuses[0].state.waiting.reason}' \
    2>/dev/null
}

# Grafana's restart count, for the Bug 2 fix
grafana_restarts() {
  kubectl get pod -n monitoring -l app.kubernetes.io/name=grafana \
    -o jsonpath='{.items[0].status.containerStatuses[0].restartCount}' \
    2>/dev/null
}

: > watch.log
for i in $(seq 1 26); do
  state=$(alert_state)
  echo "$(date -u +%H:%M:%S) alert=${state:-?} crashtest=[$(crashtest_status)] grafana_restarts=$(grafana_restarts)" >> watch.log
  if [ "$i" -lt 26 ]; then sleep 60; fi
done
cat watch.log
```

Here is part of its output, in UTC.

```text
18:38:31 alert=inactive crashtest=[2 ] grafana_restarts=0
18:39:35 alert=pending crashtest=[4 ] grafana_restarts=0
...
18:42:47 alert=pending crashtest=[5 CrashLoopBackOff] grafana_restarts=0
18:43:51 alert=firing crashtest=[6 ] grafana_restarts=0
18:44:56 alert=firing crashtest=[6 CrashLoopBackOff] grafana_restarts=0
...
18:58:53 alert=firing crashtest=[9 ] grafana_restarts=0
18:59:57 alert=firing crashtest=[9 ] grafana_restarts=0
19:01:02 alert=firing crashtest=[9 CrashLoopBackOff] grafana_restarts=0
...
19:04:14 alert=firing crashtest=[10 ] grafana_restarts=0
19:05:18 alert=firing crashtest=[10 CrashLoopBackOff] grafana_restarts=0
```

When no reason follows the restart count, the container was not waiting at
that moment, and that is a gap. Once the alert started firing at 18:43:51, it
stayed firing through every gap after that.

The image below is the same half hour in Prometheus, with one query per graph:

- Top, the raw series,
  `kube_pod_container_status_waiting_reason{reason="CrashLoopBackOff",pod="crashtest"}`.
  It asks, is the pod in CrashLoopBackOff right now?
- Bottom, what the rule checks, the same series inside `max_over_time(...[5m])`.
  It asks, was the pod in CrashLoopBackOff at any point in the last 5 minutes?

Each loop line with no reason falls inside one of the top graph's blank gaps.

The top query's answer is yes or no:

- `1` means yes.
- No value at all means no. kube-state-metrics does not send `0` here.

So on a graph the series shows as dashes at 1, with blank gaps between them. A
blank gap is no value, not 0:

- A 0 would draw a line along the bottom of the graph. The line never goes
  there.
- At each restart the container stops waiting for 75 to 90 seconds. With no
  CrashLoopBackOff to report, kube-state-metrics sends nothing, and Prometheus
  has nothing to draw.

{{< figure src="media/crash-rule-holds.webp" alt="Two Prometheus graphs over 35 minutes. The top one, the raw CrashLoopBackOff series, is a row of dashes at 1 with gaps between them. The bottom one, the same series through max_over_time over 5 minutes, is one unbroken line at 1." caption="Top, the raw series. It disappears for 75 to 90 seconds at every restart. Bottom, what the rule checks. One unbroken line." >}}

Prometheus checks every 15 seconds, so each gap length is accurate to about 15
seconds. The raw series was missing five times:

| Gap started (UTC) | Missing for | Then CrashLoopBackOff for |
|---|---|---|
| 18:43:41 | 1 minute 15 seconds | 3 minutes 45 seconds |
| 18:48:41 | 1 minute 15 seconds | 3 minutes 45 seconds |
| 18:53:41 | 1 minute 15 seconds | 4 minutes |
| 18:58:56 | 1 minute 30 seconds | 3 minutes 30 seconds |
| 19:03:56 | 1 minute 30 seconds | past the end of the graph |

That is one gap about every 5 minutes, so the CrashLoopBackOff state lasted
about 3 and a half to 4 minutes at a time.

My rule comment had guessed the gaps lasted a few seconds. They were
much longer, and the 5 minute window still covered them.

At 19:13:42 the alert was still firing, half an hour after it started, and I
deleted the pod. The old rule had gone quiet ten and a half minutes after it
fired.

### Why the plain rule never fires, step by step

<div id="clb-timeline"></div>
<script src="timeline.js"></script>

### Questions about the gaps

{{< accordion mode="collapse" separated=true >}}
{{< accordionItem title="Why does Kubernetes wait 5 minutes between restarts?" >}}
After each crash, Kubernetes doubles the wait before the next restart: 10, 20, 40, 80 and 160 seconds. It stops growing at 5 minutes, so from the sixth restart on, every wait is 5 minutes. The wait goes back to 10 seconds only after the container runs for 10 minutes without crashing.
{{< /accordionItem >}}
{{< accordionItem title="Does the pod take 75 seconds to show CrashLoopBackOff after each restart?" >}}
About 75 to 90 seconds in this run. Right after each crash, the pod is not marked as waiting in CrashLoopBackOff yet, so the metric has no value. Then it shows CrashLoopBackOff until the next restart.
{{< /accordionItem >}}
{{< accordionItem title="Is the blank gap a 0?" >}}
No. A 0 would draw a line along the bottom of the graph. During the gap the metric sends nothing at all, so there is nothing to draw.
{{< /accordionItem >}}
{{< accordionItem title="Is the 75 seconds a separate wait between restarts?" >}}
No. Kubernetes waits 5 minutes between restarts once the back-off reaches its cap. The 75 seconds is the first part of that 5 minute wait.
{{< /accordionItem >}}
{{< accordionItem title="What does for: 5m do?" >}}
Prometheus sends the alert only after the rule's condition has been true for 5 minutes in a row. It stops one short crash from alerting anyone. kubernetes-mixin uses 15 minutes.
{{< /accordionItem >}}
{{< accordionItem title="Is for: 5m the same as the 5 minute back-off?" >}}
No, the same number by chance. The back-off is Kubernetes waiting between restarts. `for: 5m` is Prometheus waiting before it alerts.
{{< /accordionItem >}}
{{< accordionItem title="What happens if the plain rule never alerts?" >}}
The pod stays crashed and nobody is told. The first sign is a user reporting that something is broken.
{{< /accordionItem >}}
{{< accordionItem title="Why does max_over_time fix it?" >}}
It asks whether the metric was 1 at any point in the last 5 minutes. The gap is only 75 to 90 seconds, so there is always a 1 inside those 5 minutes, and the count never resets.
{{< /accordionItem >}}
{{< /accordion >}}

## Bug 2, Grafana's memory limit

While I was working in Grafana, it stopped answering. My `kubectl port-forward`,
the tunnel from my machine to the pod, had died. The pod showed one restart.
A restart kills any `port-forward` attached to the old container, which is why
mine died. So I asked for its last five events.

```bash
kubectl get events -n monitoring \
  --field-selector involvedObject.name=grafana-f4995c66f-9n9kw \
  --no-headers | tail -5
```

```text
2m1s   Warning   Unhealthy   pod/grafana-f4995c66f-9n9kw   Liveness probe failed: Get "http://10.0.2.53:3000/api/health": context deadline exceeded (Client.Timeout exceeded while awaiting headers)
95s    Warning   Unhealthy   pod/grafana-f4995c66f-9n9kw   Readiness probe failed: Get "http://10.0.2.53:3000/api/health": context deadline exceeded (Client.Timeout exceeded while awaiting headers)
2m1s   Normal    Killing     pod/grafana-f4995c66f-9n9kw   Container grafana failed liveness probe, will be restarted
91s    Warning   Unhealthy   pod/grafana-f4995c66f-9n9kw   Readiness probe failed: Get "http://10.0.2.53:3000/api/health": read tcp 10.0.2.242:60322->10.0.2.53:3000: read: connection reset by peer
91s    Normal    Pulled      pod/grafana-f4995c66f-9n9kw   Container image "grafana/grafana:13.2.2" already present on machine and can be accessed by the pod
```

The first line is the liveness probe timing out. The third is the kubelet
killing the container because of it.

A liveness probe is a health check the kubelet runs against the container. If
it fails enough times in a row, the kubelet kills the container and starts a
new one.

That is what happened here. Grafana was still running, but it was too slow to
answer within a second, so the kubelet killed it. Why it was slow comes after
the probe. This was the probe in the repo:

```yaml
livenessProbe:
  httpGet:
    path: /api/health
    port: http
  initialDelaySeconds: 60
  periodSeconds: 10
```

It sets no `timeoutSeconds` and no `failureThreshold`, so Kubernetes used its
defaults:

- `timeoutSeconds: 1`. Each check waits 1 second for an answer.
- `failureThreshold: 3`. After 3 failed checks in a row, the kubelet restarts
  the container.

The checks run 10 seconds apart, so for at least 20 seconds Grafana never
answered within a second.

The events above show the failed check only once. That does not mean it failed
once. When the same event happens again, with the same reason and the same
message, Kubernetes does not add a new event. It adds 1 to the old event's
count. The two commands show that count differently:

- `kubectl get events` prints one line per event and hides the count. Add
  `-o wide` to see a COUNT column.
- `kubectl describe pod` shows it in the Age column, as something like
  `(x3 over 27s)`.

`(x3 over 27s)` means the liveness check failed 3 times, and the first failure
was 27 seconds before I ran the command. The checks run 10 seconds apart, so
the three failures took 20 seconds.

I checked both later on a local kind cluster, with a test pod using the same
probe settings. The liveness line showed COUNT 3.

I did run `kubectl describe pod` after the second restart. But I filtered its
output to the Last State lines, so the Events part, which would have shown the
count, was never saved. The cluster is gone now. So for Grafana, the 3 failed
checks come from the default `failureThreshold`, not from a log.

Next I looked at why Grafana was slow.

Memory shows up in three units in this section:

| Unit | Where you see it | Size |
|---|---|---|
| `Mi` | Kubernetes settings, like the 512Mi limit | 1 Mi = 1,048,576 bytes (1,024 × 1,024) |
| `MiB` | numbers I measured with Prometheus | 1&nbsp;MiB = 1,048,576 bytes, the same as 1&nbsp;Mi |
| `Mil` | Grafana's graph on the second run | 1&nbsp;Mil = 1,000,000 bytes (1,000 × 1,000) |

I asked Prometheus for Grafana's memory in MiB:

```text
container_memory_working_set_bytes{
  namespace="monitoring",
  container="grafana"
} / 1048576
```

{{< figure src="media/grafana-memory-1235-on.webp" alt="Graph of Grafana container memory from 12:35 to 13:05 UTC, climbing from about 370 MiB to 510 MiB, then a new container starting at about 350 MiB" caption="Grafana's working set climbing to 510&nbsp;MiB against a 512Mi limit. The second line is the replacement container, starting at about 350&nbsp;MiB. Cropped to the half hour with data. [See the full screenshot](media/grafana-memory.webp)." >}}

To read it:

- Time runs left to right, in UTC. Add 5 hours 30 minutes for IST, so 12:55 is
  18:25 IST.
- Height is memory in MiB. The query above divides bytes by 1,048,576 to get
  MiB.
- Working set is the container's memory minus cache the kernel can easily
  free. When it reaches the limit, there is nothing easy left to free.
- The teal line is the first container. It starts at 12:40 at about 370&nbsp;MiB,
  drops to about 320, starts climbing at 12:48, passes 490 at about 12:50,
  and reaches 510 at about 12:55.
- The green line is the replacement container. It starts at 12:56 at about
  350&nbsp;MiB.
- The teal line stays flat until about 13:00, but that container had stopped
  at 12:55:52. Prometheus kept drawing its last value for about 5 minutes, so
  the flat end is a leftover, not memory in use.

A container can have two memory numbers. The repo set both for Grafana:

- **Request, 192Mi.** Kubernetes counts this much when it picks a node for the
  container. The container can use more if the node has memory free.
- **Limit, 512Mi.** The most it may use. If it needs more and the kernel cannot
  free any, the kernel kills it. This is an out-of-memory (OOM) kill.

Doing nothing, Grafana sat between about 320 and 370&nbsp;MiB, so the request was
below its idle use. Light use, a few logins and a few pages, took it from 320
to 510&nbsp;MiB in about seven minutes.

Near the limit, the kernel most likely spent its time reclaiming memory to stay
under it. That would slow down everything in the container, which fits the
events above. The health check waits only one second for an answer, and it
stopped getting one.

CPU can slow a container down too, so I checked it next.

Kubernetes measures CPU in millicores, written with an `m`:

- `1000m` is one whole CPU core.
- `250m` is a quarter of a core. This is the repo's limit for Grafana.
- `m` is for CPU and `Mi` is for memory. Do not mix them up.

Here is how the limit works. The kernel splits time into slices of 100
milliseconds. Linux calls each slice a period, which is why the second query
below counts `cfs_periods`. A `250m` limit lets Grafana use 25 milliseconds of CPU time in
each slice. If it uses them up early, it has to wait for the next slice, even
when the CPU is free. This waiting is called throttling.

For example, say Grafana needs 30 milliseconds of work. It does 25, waits until
the slice ends, and finishes the last 5 in the next slice.

Two minutes after the restart, at 18:27 IST, I asked Prometheus three questions
about the last 15 minutes.

**How much CPU did Grafana use at its busiest minute?**

```text
max_over_time(
  rate(
    container_cpu_usage_seconds_total{
      namespace="monitoring",
      container="grafana"
    }[1m]
  )[15m:30s]
)
```

It returned two numbers, one for the old container and one for the new:

- 0.098 cores, which is `98m`
- 0.147 cores, which is `147m`

Both are below the `250m` limit. The higher one is about 59% of it.

A minute is an average, though. Inside that minute, Grafana could still have
had short bursts that hit the limit. The next question checks for those.

**How often did the CPU limit hold Grafana back?**

```text
sum by (container) (
  increase(
    container_cpu_cfs_throttled_periods_total{
      namespace="monitoring",
      container="grafana"
    }[15m]
  )
)
/
sum by (container) (
  increase(
    container_cpu_cfs_periods_total{
      namespace="monitoring",
      container="grafana"
    }[15m]
  )
)
```

It returned 0.038, which means rarely. In 3.8% of the slices, about 1 in 26,
Grafana used its whole 25 milliseconds and had to wait. In the other 25, it
finished early.

This number is not how much CPU Grafana used. The first question answered that.
This one counts how often it hit the limit.

**How much memory did it use at its peak?**

```text
max_over_time(
  container_memory_working_set_bytes{
    namespace="monitoring",
    container="grafana"
  }[15m]
) / 1048576
```

It returned 511.125 for the old container and 351.867 for the new one. The
old one was less than 1&nbsp;MiB short of its 512Mi limit. The new one had been up
for less than two minutes, so 351.867 was only its idle use.

| | Highest use | Limit | How close to the limit |
|---|---|---|---|
| CPU | `147m` | `250m` | about 59% |
| Memory | 511.125&nbsp;MiB | 512Mi | 99.8% |

CPU had room to spare. Memory did not.

Nineteen minutes later it happened again after a few more Explore page loads.
This time the reason was not a probe.

```bash
kubectl describe pod -n monitoring -l app.kubernetes.io/name=grafana
```

```text
...
    Last State:     Terminated
      Reason:       OOMKilled
      Exit Code:    137
      Started:      Wed, 28 Oct 2026 18:25:52 +0530
      Finished:     Wed, 28 Oct 2026 18:44:59 +0530
...
```

Started is when the new container came up after the first restart. Finished
is when the kernel killed it, 19 minutes later.

{{< alert icon="bug" cardColor="#331a1a" iconColor="#ef4444" textColor="#fca5a5" >}}
Exit code 137 alone does not tell you it ran out of memory. It only means the process got SIGKILL. Read the reason in `kubectl describe pod`.

- `OOMKilled` means the kernel killed it for using too much memory.
- A liveness restart can end with 137 too.

In this run:

- The first restart showed `Reason: Error` with exit code 137, and its events showed "Liveness probe failed".
- The second showed `OOMKilled`.

The memory limit caused the second and most likely the first too.
{{< /alert >}}

The fix in `grafana-deployment.yaml` raised the memory request from 192Mi to
384Mi and the limit from 512Mi to 1Gi. It also gave the liveness probe a 5
second timeout.

```yaml
resources:
  requests:
    cpu: 100m
    memory: 384Mi
  limits:
    cpu: 250m
    memory: 1Gi
livenessProbe:
  httpGet:
    path: /api/health
    port: http
  initialDelaySeconds: 60
  periodSeconds: 10
  timeoutSeconds: 5
```

On the second run I tested the memory fix first. Claude, the AI assistant I
used during the run, loaded the same kind of Explore page five times in a row.
It used a headless browser, which is Chrome with no window, controlled by a
script. Then it kept using Grafana to take the screenshots for this post.

{{< figure src="media/grafana-memory-1gi.webp" alt="Grafana Explore graph of Grafana's working set rising to about 640 million bytes, then settling around 420 million, under a flat limit line at 1Gi" caption="Grafana's memory on the second run. It peaked at 610&nbsp;MiB, above the old 512Mi limit, and stayed well under the new one." >}}

It peaked at 610&nbsp;MiB. Under the old 512Mi limit that would have been an OOM
kill. Under the 1Gi limit it settled back to about 400&nbsp;MiB, and the pod finished the run with 0
restarts.

The graph's axis is in Mil, so 610&nbsp;MiB shows as about 640&nbsp;Mil, and 400&nbsp;MiB as
about 420.

### What I would run next time

These are the commands I would run straight away for any pod that restarts,
and what to read in each. Swap `<pod>` for the pod's name. I did not run
numbers 4 and 5 during the live run. I would add them next time.

1. `kubectl get pods -n monitoring` shows how many times each pod restarted, in
   the RESTARTS column.
2. `kubectl describe pod -n monitoring <pod>`. Read all of it. I kept only Last
   State and lost the count. Three parts matter:
   - Last State gives the reason and the exit code. `OOMKilled` means it ran
     out of memory. Any other reason, such as `Error`, means it did not, so
     check the events for a liveness restart.
   - The Liveness line gives the probe's real settings with the defaults
     filled in, such as `timeout=1s period=10s #failure=3`.
   - Events lists what happened, with a count, such as `(x3 over 27s)`.
3. `kubectl get events -n monitoring --field-selector involvedObject.name=<pod>`
   lists the same events. Kubernetes deletes events after an hour by default,
   so run it soon.
4. `kubectl logs -n monitoring <pod> --previous` shows the logs of the
   container that was killed, not the new one.
5. `kubectl get pod -n monitoring <pod> -o yaml` shows the whole probe with
   every default filled in, so you see `timeoutSeconds: 1` even when your YAML
   never set it.
6. The three Prometheus queries above show whether memory or CPU slowed it
   down.

## Breaking it twice, with a node that stops reporting

The second test was a dead node.

### Why terminating the instance would not work

Terminating the EC2 instance looks like the easy way, right? It is easy, but
the alert would never fire. When an instance disappears, AWS's cloud controller
deletes its `Node` object from Kubernetes, as the
[Kubernetes docs](https://kubernetes.io/docs/concepts/architecture/cloud-controller/#node-controller)
describe. Then kube-state-metrics stops reporting that node's `Ready` status.
The rule's `for: 5m` fires only after the node has been in the `NotReady`
state for 5 minutes in a row. A terminated node is deleted well before that, so
its status disappears and the alert never fires.

### Stopping the kubelet instead

To the control plane, a real node failure looks like a kubelet that stops
reporting. So I stopped the kubelet on the node that was not running
Prometheus.

```bash
kubectl debug node/<node-name> \
  --profile=sysadmin \
  --image=busybox:1.37 \
  -- nsenter -t 1 -m -u -i -n -p \
  -- systemctl stop kubelet
```

Each part of the command does one job.

- `kubectl debug node/<node-name>` starts a pod on that node. The pod shares
  the host's processes and network.
- `--profile=sysadmin` makes the pod privileged, so it can change things on
  the host.
- `--image=busybox:1.37` picks a small image that includes `nsenter`.
- The first `--` ends kubectl's options. Everything after it runs inside the
  pod.
- `nsenter -t 1` joins the namespaces of process 1. Because the pod shares the
  host's processes, process 1 is the host's `systemd`.
- `-m -u -i -n -p` picks which namespaces to join: mount (the host's files),
  UTS (its hostname), IPC, network and PID (its processes).
- The second `--` ends nsenter's options. Everything after it runs as the
  host.
- `systemctl stop kubelet` stops the kubelet until the next boot.

On a private node with no SSH, that's the closest thing to logging in.

`nsenter`, short for "namespace enter", runs a command inside the namespaces of
another process. Namespaces are the Linux feature that gives each container its
own view of processes, the network, files and the hostname. The
[namespaces man page](https://man7.org/linux/man-pages/man7/namespaces.7.html)
explains them in full.

Why does the command need `nsenter`? The debug pod can already see the host's
processes and network. But it has its own files, from the busybox image.
busybox has no `systemctl`, so the pod cannot stop the kubelet on its own. I
tried this on my kind cluster. Running `systemctl` straight in the pod failed
with `executable file not found`.

`nsenter -t 1 -m` fixes this. Process 1 on the host is `systemd`. The `-m` flag
makes the command use the same files as process 1, which are the host's files.
So `systemctl` now comes from the host, and it can tell the host's `systemd` to
stop the kubelet.

The other flags, `-u -i -n -p`, join the host's hostname, IPC, network and
process namespaces. The debug pod is already in all four, so these flags change
nothing in this command.

Be careful who can run this command. It gives `root` on the node, the same as
running `sudo su -` there. That is dangerous on any shared cluster. In
production it can go very wrong. One wrong command can take a node down for
real users, just like my test did. Anyone with this access can also read the
secrets of every pod on that node.

By default, give this access to no one. If a task really needs it, give it only
for that task. When the task is done, remove the access and delete the debug pod
with `kubectl delete pod` straight away.
[Limiting who can run the debug command](#limiting-who-can-run-the-debug-command)
shows how.

| Time (IST) | What happened |
|---|---|
| about 19:01:15 | I stopped the kubelet |
| 19:02:11 | Node `NotReady`. Its `Ready` condition said `Unknown`, "Kubelet stopped posting node status" |
| 19:02:37 | `NodeNotReady` pending |
| by 19:07:28 | Old pods being deleted. A new Alertmanager running on the other node |
| 19:07:37 | `NodeNotReady` firing, received by the new Alertmanager |
| by 19:08:24 | Grafana running on the other node too |
| by 19:16:44 | I rebooted the instance |
| by 19:17:10 | Node `Ready` again |
| by 19:17:28 | `NodeNotReady` resolved |

The alert went pending at 19:02:37 and fired at 19:07:37, exactly 5 minutes
later. That is the rule's `for: 5m` at work. This time the node stayed
`NotReady`, so the 5 minutes could pass.

The pods were replaced at about the same time, for a different reason. By
default, a pod may stay on an unreachable node for 5 minutes. After that,
Kubernetes starts to delete it, as the
[taints and tolerations docs](https://kubernetes.io/docs/concepts/scheduling-eviction/taint-and-toleration/#taint-based-evictions)
explain. 19:02:11 plus 5 minutes is 19:07:11. The
[ReplicaSet](https://kubernetes.io/docs/concepts/workloads/controllers/replicaset/#terminating-pods)
does not wait for the old pod to finish, so it started a new copy on the other
node. The new Alertmanager was running by 19:07:28.

{{< figure src="media/nodenotready-firing.webp" alt="Prometheus alerts page with NodeNotReady firing for ip-10-0-2-242, its expression and labels expanded" caption="`NodeNotReady` firing at 19:15, after I stopped the kubelet with the `kubectl debug` command above and before the reboot. The expression checks that status true is 0, which also catches `Unknown`, as well as `False`." >}}

{{< figure src="media/am-nodenotready.webp" alt="Alertmanager UI showing NodeNotReady for ip-10-0-2-242 under the slack-critical receiver, started at 2026-10-28T13:37:37Z" caption="`NodeNotReady` in Alertmanager, under the same `slack-critical` receiver as the crash alert. It started firing at 13:37:37 UTC, which is 19:07:37 my time." >}}

I had not set up Slack for these tests. The repo ships a placeholder webhook,
so this alert reached Alertmanager but no Slack channel. With a real webhook in
the Alertmanager config, it would post to Slack about 10 seconds after it
fired, because the config groups alerts for 10 seconds (`group_wait: 10s`)
before sending. Critical alerts repeat every 5 minutes
(`repeat_interval: 5m`) while the node stays down.

The quickest way to check a node is `kubectl get nodes`. This is what it
printed at 19:02:50, during the test. I kept only the first two columns.

```bash
kubectl get nodes
```

```text
NAME                         STATUS
ip-10-0-1-10.ec2.internal    Ready
ip-10-0-2-242.ec2.internal   NotReady
```

The first node was healthy. The second was the one I broke. `NotReady` tells
you something is wrong, but not what.

To see what is wrong, look at the node's health report. Kubernetes keeps one for
every node. It is a list of questions, each with an answer. Kubernetes calls
these questions conditions, so `kubectl describe node` prints them under
`Conditions:`. This is the broken node's report at 19:02:50:

```bash
kubectl describe node \
  ip-10-0-2-242.ec2.internal
```

```text
Conditions:
  Type             Status
  ----             ------
  MemoryPressure   Unknown
  DiskPressure     Unknown
  PIDPressure      Unknown
  Ready            Unknown
```

Again, I kept only the first two columns. `Type` is the question and `Status`
is the answer.

- `MemoryPressure` asks "is the node low on memory?"
- `DiskPressure` asks "is the node low on disk space?"
- `PIDPressure` asks "is the node running too many processes?"
- `Ready` asks "can the node run pods?"

My
[alert](https://github.com/khadirullah/terraform-eks-monitoring/blob/main/k8s/monitoring/prometheus-config.yaml#L165)
only checks the `Ready` question. Its answer can be one of three words, as the
[Kubernetes docs](https://kubernetes.io/docs/reference/node/node-status/)
explain:

- `True` means yes, the node is healthy.
- `False` means no, the kubelet says the node is not healthy.
- `Unknown` means there is no answer.

How does Kubernetes know there is no answer? The kubelet sends two separate
messages to the control plane, the part of Kubernetes that manages the cluster:

1. Every 10 seconds, a short message that only says "this node is still alive".
2. Whenever an answer changes, the health report. It holds the `True` or
   `False` answer to each of the four questions above.

The control plane keeps checking when it last heard from each node. If nothing
comes for 50 seconds, it sets the answers to `Unknown`. The kubelet never sends
`Unknown` itself.

{{< mermaid >}}
graph TD
    kubelet["kubelet on the node"]
    cp["control plane"]
    check["heard from the node<br/>in the last 50 seconds?"]
    keep["keep the kubelet's answers<br/>True or False"]
    unknown["set every answer to Unknown"]
    kubelet -- "every 10 seconds<br/>this node is still alive" --> cp
    kubelet -- "when an answer changes<br/>health report" --> cp
    cp --> check
    check -- "yes" --> keep
    check -- "no" --> unknown
{{< /mermaid >}}

The 10 seconds is fixed in the kubelet. The 50 seconds is only a default. On a
cluster you run yourself, you can change it with this control plane setting,
shown here with its default:

```text
--node-monitor-grace-period=50s
```

On EKS you cannot, because AWS runs the control plane.

In my test I had stopped the kubelet. No message came, so every answer turned
to `Unknown` at 19:02:11.

`kubectl get nodes` turns these answers into one word:

- `Ready` when the answer is `True`
- `NotReady` when the answer is `False` or `Unknown`

That is why `kubectl get nodes` showed `NotReady` for the broken node at
19:02:50.

A Prometheus metric holds a number, not a word like `True`. So
kube-state-metrics turns each node's `Ready` answer into three numbers. Each
number is either 1 or 0:

- `true` is 1 when the answer is `True`, and 0 otherwise.
- `false` is 1 when the answer is `False`, and 0 otherwise.
- `unknown` is 1 when the answer is `Unknown`, and 0 otherwise.

Only one of the three is 1 at a time. Think of three tick boxes with one box
ticked.

For example, at 19:02:50:

- The healthy node, `ip-10-0-1-10`, answered `True`. So its numbers were
  `true` 1, `false` 0 and `unknown` 0.
- The broken node, `ip-10-0-2-242`, answered `Unknown`. So its numbers were
  `true` 0, `false` 0 and `unknown` 1.

This table shows all three possible answers. Each column is one `status` value.

| `Ready` answer | `true` | `false` | `unknown` |
|---|---|---|---|
| `True` | 1 | 0 | 0 |
| `False` | 0 | 1 | 0 |
| `Unknown` (this test) | 0 | 0 | 1 |

The rule reads only the `true` column:

```text
kube_node_status_condition{
  condition="Ready",
  status="true"
} == 0
```

Read it one part at a time:

- `condition="Ready"` picks the question "can the node run pods?"
- `status="true"` picks the answer "yes".
- `== 0` keeps only the nodes where that number is 0.

A healthy node has a 1, so the rule skips it. A node with `False` or `Unknown`
has a 0, so the rule keeps it. If that number stays 0 for 5 minutes in a row,
the alert fires. If it goes back to 1 even once, the 5 minutes start again.
That wait is the `for: 5m` in the rule.

Why does the rule look at `true` and not at `false`? Look at the table above:

- When the node is healthy, `true` is 1.
- When the node is broken, `true` is 0. This is the same for `False` and
  `Unknown`.

So one rule on `true` catches every broken node.

The alert does not tell you which answer it was, `False` or `Unknown`. To find
out, run `kubectl describe node`.

The `false` number only turns to 1 when the answer is `False`. In my test the
answer was `Unknown`, so `false` stayed 0. A rule that watched `false` would
have missed my broken node.

The target page told a more precise story than the node status.

{{< figure src="media/dead-node-targets.webp" alt="Prometheus kubernetes-cadvisor pool, one target UP on 10.0.1.10 and one DOWN on 10.0.2.242 with connection refused" caption="cAdvisor on the dead node is DOWN with connection refused. On the same node, node-exporter was still UP." >}}

The kubelet and cAdvisor targets on that node went DOWN with connection
refused. cAdvisor is the part of the kubelet that measures each container's CPU
and memory. It runs inside the kubelet, so it stopped when the kubelet stopped.

On the same node, node-exporter was still UP. It is a pod too, but it runs in
its own container, not inside the kubelet, so it kept running. "Connection refused" also means the machine answered, but nothing
was listening on that port. So the machine was fine. Only the kubelet was gone.

`NotReady` means the control plane lost contact with the kubelet. It does not
mean the server is off. I stopped the kubelet on purpose, but the same thing
happens in a real cluster when the kubelet keeps crashing. The server keeps
running, yet the node shows `NotReady`.

### Bringing the node back

`systemctl stop` stopped the kubelet only until the next boot. The kubelet is
still enabled, so a reboot starts it again. I looked up the node's instance ID
from its name, then rebooted it.

```bash
aws ec2 describe-instances --region us-east-1 \
  --filters "Name=private-dns-name,Values=ip-10-0-2-242.ec2.internal" \
  --query 'Reservations[].Instances[].InstanceId' --output text
```

That prints the instance ID, which starts with `i-`.

```bash
aws ec2 reboot-instances --region us-east-1 \
  --instance-ids <instance-id>
```

`reboot-instances` prints nothing when it works.

The node was `Ready` by 19:17:10, less than a minute after the reboot. The alert
resolved by 19:17:28.

{{< figure src="media/node-ready-dip.webp" alt="Graph of the Ready status for both nodes, one flat at 1 and the other dropping to 0 for about fifteen minutes then returning to 1" caption="The `true` number for `Ready`, one line per node. The broken node's line drops to 0 at about 13:32 UTC (19:02 IST), when its answer turned `Unknown`. It goes back to 1 at about 13:47 UTC (19:17 IST), after the reboot. The healthy node stays at 1." >}}

### Limiting who can run the debug command

{{< alert icon="shield" cardColor="#1a2633" iconColor="#60a5fa" textColor="#93c5fd" >}}
Whoever can create this debug pod gets `root` on that node. That means full
control of the machine.

It does not stop at the machine. Each EKS node has an IAM role, which is the
set of AWS permissions the node uses. With `root`, you can use those
permissions too.
{{< /alert >}}

I could create the debug pod because of how my code set up the cluster:

- My Terraform code makes whoever runs `terraform apply` a full admin of the
  cluster. So Kubernetes let me create any pod.
- No namespace had Pod Security rules. So nothing checked that the pod asked
  for `root`.

That is fine for a practice cluster where I am the only user. On a shared or
production cluster, close both gaps. Four things help:

- [RBAC](https://kubernetes.io/docs/reference/access-authn-authz/rbac/), the
  Kubernetes list of who may do what. Most people need read-only access. Anyone
  who can create pods in a namespace can start a debug pod like mine there.
- [Pod Security Admission](https://kubernetes.io/docs/concepts/security/pod-security-admission/),
  a check built into Kubernetes that runs on every new pod. Give a namespace
  this label:

  ```text
  pod-security.kubernetes.io/enforce=baseline
  ```

  Kubernetes then refuses privileged pods there, along with pods that share the
  host's processes or network.
- Switch off the automatic admin before the first apply. In the
  `access_config` block of `aws_eks_cluster`, set this:

  ```hcl
  bootstrap_cluster_creator_admin_permissions = false
  ```

  Then pick who should be admin instead, for example an IAM role your admins
  log in as. The code below does two things:

  1. `aws_eks_access_entry` puts the role on the cluster's list of who may log
     in.
  2. `aws_eks_access_policy_association` gives that role the admin policy.

  ```hcl
  resource "aws_eks_access_entry" "admin" {
    cluster_name  = aws_eks_cluster.main.name
    principal_arn = "arn:aws:iam::111122223333:role/eks-admin"
  }

  resource "aws_eks_access_policy_association" "admin" {
    cluster_name  = aws_eks_cluster.main.name
    principal_arn = aws_eks_access_entry.admin.principal_arn
    policy_arn    = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"

    access_scope {
      type = "cluster"
    }
  }
  ```

  Replace the role ARN with your own. An ARN is AWS's full ID for something it
  holds, here the role. Put this code in the same `terraform apply` that creates
  the cluster. If you leave it out, nobody can use `kubectl` on the new cluster
  until someone adds an access entry.
  [AWS reads the `false` setting only when it creates the cluster](https://docs.aws.amazon.com/eks/latest/APIReference/API_CreateAccessConfigRequest.html),
  so changing it later makes Terraform rebuild the whole cluster. This code
  passes `terraform validate`, but I have not applied it on EKS.
- [EKS access entries](https://docs.aws.amazon.com/eks/latest/userguide/access-entries.html)
  and [audit logs](https://docs.aws.amazon.com/eks/latest/userguide/control-plane-logs.html).
  Give each person their own access entry with the smallest policy that does
  the job. Turn on the `audit` log type. EKS then sends a record of who created
  each pod to CloudWatch Logs. My Terraform code never set
  `enabled_cluster_log_types`, so nothing in AWS recorded that I created the
  debug pod.

I checked the Pod Security label on my local kind cluster, not on EKS. That
cluster is named `uptime`, so its node is called `uptime-control-plane`. I gave
a test namespace the `baseline` label. Then I ran a debug pod like the one from
the dead node test. This time the command inside only checks whether the
kubelet is running, so it changes nothing on the node:

```bash
kubectl create namespace psa-baseline
kubectl label namespace psa-baseline \
  pod-security.kubernetes.io/enforce=baseline
kubectl debug \
  node/uptime-control-plane \
  -n psa-baseline \
  --profile=sysadmin \
  --image=busybox:1.37 \
  -- nsenter -t 1 -m -- \
  systemctl is-active kubelet
```

Kubernetes refused it before any pod started:

```text
Creating debugging pod node-debugger-uptime-control-plane-dmzfl with container debugger on node uptime-control-plane.
Error from server (Forbidden): pods "node-debugger-uptime-control-plane-dmzfl" is forbidden: violates PodSecurity "baseline:latest": host namespaces (hostNetwork=true, hostPID=true, hostIPC=true), hostPath volumes (volume "host-root"), privileged (container "debugger" must not set securityContext.privileged=true)
```

The error lists each setting that `baseline` forbids. `--profile=sysadmin` asks
for all of them.

### Three things I had not expected

The old pods stayed in `Terminating` on the dead node until the reboot
brought the kubelet back. The kubelet is what confirms a pod has stopped, and
that was the thing I had stopped. On that node, node-exporter was still UP, so
the old Grafana may still have been running too. Kubernetes cannot tell a dead
node from one that only stopped reporting, so it waits for the kubelet instead
of deleting the pod itself.

Once the new Grafana and Alertmanager pods were running on the surviving
t3.small, I checked how much memory that node had promised. This is the end of
`kubectl describe node` at 19:14:

```bash
kubectl describe node ip-10-0-1-10.ec2.internal
```

```text
Allocated resources:
  (Total limits may be over 100 percent, i.e., overcommitted.)
  Resource           Requests      Limits
  --------           --------      ------
  cpu                790m (40%)    1050m (54%)
  memory             1004Mi (70%)  2292Mi (160%)
  ephemeral-storage  0 (0%)        0 (0%)
  hugepages-1Gi      0 (0%)        0 (0%)
  hugepages-2Mi      0 (0%)        0 (0%)
```

The percentages are of what pods may use on that node. Of its 2&nbsp;GiB,
Kubernetes leaves about 1.4&nbsp;GiB for pods and keeps the rest for the operating
system and the kubelet. These are the memory settings behind the two totals:

| Pod | Request | Limit |
|---|---|---|
| prometheus | 512Mi | 1Gi |
| grafana | 192Mi | 512Mi |
| alertmanager | 64Mi | 128Mi |
| kube-state-metrics | 64Mi | 192Mi |
| node-exporter | 32Mi | 96Mi |
| coredns, 2 pods | 140Mi | 340Mi |
| **Total** | **1004Mi** | **2292Mi** |

The first five come from my YAML files at the time of the run. The two coredns
pods come with EKS, and 70Mi and 170Mi per pod are its defaults.

The requests of all those pods add up to 1004Mi. That is 70 percent of the
1.4&nbsp;GiB pods may use, so the scheduler was happy to place every pod. Their
limits add up to 2292Mi, which is 160 percent of the same 1.4&nbsp;GiB. That is
called overcommitted. The limits promise pods more memory than the node can
give them.

Those totals use Grafana's old 512Mi limit. With the fixed 1Gi limit from
Bug 2, the limits would add up to about 196 percent.

With only two nodes, losing one puts the whole stack on the other node in that
state. In this run the node used only 51 percent of its full 2&nbsp;GiB, so
nothing broke. If one busy pod grew toward its limit, the node would run short
of memory. The kubelet would then stop pods to free memory, and if memory ran
out faster than that, the kernel would kill containers.

Grafana and Alertmanager did not come back to the rebooted node. Kubernetes
does not move running pods back on its own, so both stayed on the node that
survived. To spread them out again, I would have to restart their Deployments,
for example with `kubectl rollout restart deployment grafana -n monitoring`.
The scheduler then places the new pods, most likely on the emptier node. The
pods that run on every node, such as node-exporter, never left
the rebooted node. They restarted in place when its kubelet came back.

## Bug 3, an upgrade policy nobody set

This one turned up in the destroy plan, in a block I had never written. Before
`terraform destroy` deletes anything, it prints each resource it will remove,
with the values it has now.

```text
- upgrade_policy {
    - support_type = "EXTENDED" -> null
  }
```

Each Kubernetes version on EKS gets a period of standard support. After that
comes extended support, which costs more. The control plane goes from $0.10 to
$0.60 an hour.

The repo pins the cluster to a version inside standard support. A comment says
this keeps the bill predictable. But the cluster never set `upgrade_policy`, so
AWS used its default, `EXTENDED`. When the version leaves standard support, an
extended cluster keeps running and starts billing at the extended rate. Pinning
the version does nothing about that.

```hcl
upgrade_policy {
  support_type = "STANDARD"
}
```

With `STANDARD`, AWS upgrades the control plane to the next version when
standard support ends. A forced upgrade can break workloads, because the new
version may remove APIs those workloads still use. That is the risk I accepted.
This cluster is meant to be torn down the same day, so the policy should never
matter. It only matters if I forget the cluster until March&nbsp;27,&nbsp;2027. By then
it has run for about 150 days at $0.20 an hour. That is about $700, so I never
run this cluster that long. `STANDARD` at least stops that bill from growing by
another $0.50 an hour, and nothing on this cluster needs protecting from an
upgrade.

Here is what each policy does on that day.

{{< mermaid >}}
---
config:
  flowchart:
    wrappingWidth: 300
---
flowchart TB
    eos["March 27, 2027<br/>standard support for 1.35 ends"]
    ext["EXTENDED<br/>the AWS default"]
    std["STANDARD<br/>set in the repo now"]
    extOut["The cluster stays on 1.35<br/>control plane $0.60 an hour"]
    stdOut["AWS upgrades to the next version<br/>control plane stays $0.10 an hour<br/>apps that use removed APIs can break"]
    eos --> ext --> extOut
    eos --> std --> stdOut
{{< /mermaid >}}

The second run's plan showed `+ upgrade_policy { + support_type = "STANDARD" }`
before anything was created. The console agreed once the cluster was up.

{{< figure src="media/eks-upgrade-policy-standard.webp" alt="EKS clusters list showing eks-monitoring Active on 1.35, support period standard support until March 27, 2027, upgrade policy Standard support" caption="The EKS clusters list during the second run, with the one cluster named eks-monitoring." >}}

{{< figure src="media/eks-upgrade-policy-closeup.webp" alt="Support period: Standard support until March 27, 2027. Upgrade policy: Standard support." caption="The Support period and Upgrade policy columns for the same cluster. The second run set `support_type` to `STANDARD`, and the console shows the upgrade policy as Standard support. Standard support runs until March&nbsp;27,&nbsp;2027." >}}

In production I would weigh the choice the other way. Broken apps cost more
than the extended rate, which is $0.50 an hour more, about $365 a month. A team that
needs time to move off removed APIs can pick `EXTENDED` on purpose and budget
for it. The better plan is to need neither. AWS Health sends a notice before a
version leaves standard support, and EKS upgrade insights list the removed APIs
that workloads still call. A team that watches both can upgrade on its own
schedule, before AWS forces anything.

## Tearing it down

The destroy script deletes Services of type LoadBalancer first. For each one,
Kubernetes asked AWS for a load balancer, so Terraform has no record of it. That
load balancer sits in the VPC's subnets, and AWS will not delete a VPC that
still has something in it. Deleting the Service makes Kubernetes remove its own
load balancer. Every Service in this stack is ClusterIP, reachable only inside
the cluster, so there were none, and the script went straight to
`terraform destroy`.

```text
Plan: 0 to add, 0 to change, 28 to destroy.
...
aws_nat_gateway.main: Destruction complete after 52s
...
aws_eks_node_group.main: Destruction complete after 4m9s
...
aws_eks_cluster.main: Destruction complete after 2m51s
...
Destroy complete! Resources: 28 destroyed.
...
[ok] Nothing orphaned in us-east-1.
```

Eight minutes in total. Afterwards I checked again with the AWS CLI for
clusters, instances, NAT gateways, Elastic IPs, VPCs, load balancers, volumes,
IAM roles and log groups. Nothing was left.

The second teardown took under seven minutes.

```text
...
aws_nat_gateway.main: Destruction complete after 43s
...
aws_eks_node_group.main: Destruction complete after 2m10s
...
aws_eks_cluster.main: Destruction complete after 2m53s
aws_iam_role_policy_attachment.eks_cluster_policy: Destruction complete after 1s
aws_iam_role_policy_attachment.eks_vpc_resource_controller: Destruction complete after 1s
aws_subnet.public[1]: Destruction complete after 2s
aws_subnet.private[1]: Destruction complete after 2s
aws_subnet.private[0]: Destruction complete after 2s
aws_subnet.public[0]: Destruction complete after 2s
aws_security_group.eks_cluster: Destruction complete after 2s
aws_iam_role.eks_cluster: Destruction complete after 1s
aws_vpc.main: Destruction complete after 1s
Destroy complete! Resources: 28 destroyed.
...
[ok] Nothing orphaned in us-east-1.
```

The order is the part worth reading. Terraform could not touch the cluster
until the node group was gone. The subnets, security group and VPC waited for
the cluster. Once it was gone, the remaining nine resources went in a few seconds.

Here is the order from the second run's log. Each box started only after the
boxes with arrows into it were gone. The NAT gateway's path ran at the same
time as the node group.

{{< mermaid >}}
flowchart TB
    addons["3 add-ons<br/>3s"]
    rtpriv["Private route table<br/>and its 2 associations"]
    rtpub["Public route table<br/>and its 2 associations"]
    ng["Node group<br/>2m10s"]
    nat["NAT gateway<br/>43s"]
    eip["Elastic IP<br/>2s"]
    igw["Internet gateway<br/>1s"]
    nodeiam["Node IAM role<br/>and its 3 policies"]
    cluster["EKS cluster<br/>2m53s"]
    net["4 subnets<br/>and the security group"]
    clusteriam["Cluster IAM role<br/>and its 2 policies"]
    vpc["VPC<br/>1s"]
    addons --> ng
    rtpriv --> nat
    nat --> eip --> igw
    rtpub --> igw
    ng --> nodeiam
    ng --> cluster
    cluster --> net
    cluster --> clusteriam
    net --> vpc
    igw --> vpc
{{< /mermaid >}}

The same CLI check found nothing left. That includes CloudWatch log groups.
Control plane logging was never turned on, so there were none to clean up.

One thing outlives the destroy, and it is on your own machine.
`aws eks update-kubeconfig` added a context, a cluster and a user for the EKS
cluster to `~/.kube/config`. Terraform knows nothing about them. Left in place,
kubectl keeps pointing at an endpoint that no longer exists.

List what you have, switch to another context if you use one, then delete all
three entries.

```bash
kubectl config get-contexts
kubectl config use-context <another-context>
kubectl config delete-context arn:aws:eks:<region>:<account-id>:cluster/eks-monitoring
kubectl config delete-cluster arn:aws:eks:<region>:<account-id>:cluster/eks-monitoring
kubectl config delete-user    arn:aws:eks:<region>:<account-id>:cluster/eks-monitoring
```

All three share the same name, the cluster's ARN, which is AWS's full ID for a
resource. That is how `update-kubeconfig` names them. Each command prints one
line. These are the three from the second run, with my account ID and user name
masked.

```text
deleted context arn:aws:eks:us-east-1:<account-id>:cluster/eks-monitoring from /home/<user>/.kube/config
deleted cluster arn:aws:eks:us-east-1:<account-id>:cluster/eks-monitoring from /home/<user>/.kube/config
deleted user arn:aws:eks:us-east-1:<account-id>:cluster/eks-monitoring from /home/<user>/.kube/config
```

## What it costs while it runs

These are us-east-1 on-demand prices for the size I ran, checked on
October&nbsp;30,&nbsp;2026. Check the
[AWS pricing calculator](https://calculator.aws/) before you apply, because
prices change and differ by region.

| Resource | Per hour |
|---|---|
| EKS control plane, standard support | $0.10 |
| NAT gateway, before data | $0.045 |
| 2 x t3.small nodes | $0.042 |
| Public IPv4 address on the NAT gateway | $0.005 |
| 2 x 20&nbsp;GB node root volumes | under $0.01 |
| **Total** | **about $0.20** |

The NAT gateway also charges $0.045 for every GB it processes. Image pulls are
most of that here, and at that rate even a few GB costs only cents.

The public IPv4 row matters because I got it wrong. My cost notes in the repo said
the Elastic IP was free while attached to the NAT gateway. An Elastic IP is a
fixed public address you rent from AWS. It stopped being free on
February&nbsp;1,&nbsp;2024. Since that day,
[AWS has charged](https://aws.amazon.com/blogs/aws/new-aws-public-ipv4-address-charge-public-ip-insights/)
$0.005 an hour for every public IPv4 address, attached or not.

The console's Elastic IP page lists no instance for it, so it looks unused. It
is not.

{{< figure src="media/nat-eip.webp" alt="Elastic IP addresses page with one address, eks-monitoring-nat-eip, public IP 32.193.26.244, no associated instance, private IP 10.0.101.64" caption="The Elastic IP addresses page during the second run, with the NAT gateway's address, eks-monitoring-nat-eip." >}}

{{< figure src="media/nat-eip-instance-column.webp" alt="The right end of the same row: Associated instance ID is a dash, Private IP address is 10.0.101.64" caption="The right end of the same row. No instance, and a private address, 10.0.101.64, from the public subnet 10.0.101.0/24." >}}

The NAT gateway holds it. At the end of the second run, the destroy script's
`terraform destroy` step printed the NAT gateway with the same allocation ID,
public IP and private IP.

```bash
./scripts/destroy.sh
```

```text
...
  # aws_nat_gateway.main will be destroyed
  - resource "aws_nat_gateway" "main" {
      - allocation_id                      = "eipalloc-0059c1a8ffdc84b28" -> null
      ...
      - network_interface_id               = "eni-0567c6733ca3af29e" -> null
      - private_ip                         = "10.0.101.64" -> null
      - public_ip                          = "32.193.26.244" -> null
      ...
```

To check it on your own cluster while it runs, ask Terraform or the AWS CLI.
Run both from the repo root. Both print the same allocation ID, public IP and
private IP.

```bash
terraform -chdir=terraform state show aws_nat_gateway.main
aws ec2 describe-addresses --region <region> \
  --filters Name=tag:Name,Values=eks-monitoring-nat-eip
```

Nothing in the cost table above gets cheaper when the cluster sits idle. A whole day
comes to about $5, and a cluster forgotten for a month costs around $145. On
extended support the control plane alone goes from $0.10 to $0.60 an hour,
which is why Bug 3 mattered.

## What changed in the repo

The two runs led to twelve commits, one per fix. Between them they change
this.

- Grafana gets a 1Gi limit, a 384Mi request and a 5 second probe timeout.
- PodCrashLooping alerts on the CrashLoopBackOff state, and stays on through
  each restart.
- The cluster's upgrade policy is pinned to `STANDARD`.
- The README stops promising dashboards.
- A comment about why PodCrashLooping never inhibits node warnings had the
  right answer for the wrong reason. It said the alert has no `instance` label.
  Alertmanager showed it with `instance="kube-state-metrics:8080"`, which never
  matches a node name.
- The runbook explains the DNS gap after an apply.
- The runbook has both failure tests, step by step, including why terminating
  the instance is the wrong way to test the node alert.
- The rule's comment said the CrashLoopBackOff gaps last a few seconds. The
  second run measured 75 to 90 seconds.
- The cost notes no longer call the Elastic IP free.
- The deploy script's cost warning stopped claiming t3.medium nodes whatever
  the variables said.
- The README status line records both runs and what each one proved.
- The runbook's destroy section covers the kubeconfig cleanup.

## Before you try this yourself

Read the code first and understand what it builds. Then set a budget before
you apply anything. A practice run like this one shouldn't cost more than a
dollar or two.

An AWS budget does not stop the bill. Its alerts only warn you, and its actions
cannot stop the EKS control plane or the NAT gateway.

The alerts are also slow. AWS updates budget data only up to three times a day,
typically 8 to 12 hours apart, according to the
[AWS Budgets docs](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html).
This stack costs about $0.20 an hour, so it can add $2.40 before an alert
reaches you. A budget will not keep a short run under $2. It catches the
cluster you forgot, before it becomes a $145 month.

So plan to destroy the same day, and set a reminder on your phone for when you
mean to finish. Then set a budget as the safety net. If you can afford to lose
$5, alert at $2 and again at $4.

When the alert comes, destroy the cluster, even if you have not finished. The
budget matters most when money is short. Make budgets a habit, and you start
seeing where a setup can cost less.

And keep learning. Learn small and grow big.

## What I would tell myself at the start

- Validate is not testing. Three bugs sat in the repo for weeks, and neither
  `terraform validate` nor a YAML parser caught any of them.
- Break things on purpose before trusting an alert. A green target page proves
  scraping. Only a firing alert proves alerting.
- Watch an alert after it fires, not only until it fires. The crash loop rule
  went quiet after ten minutes while the pod was still broken.
- Write node alerts against `status="true" == 0`, so `Unknown` counts as not
  `Ready`.
- Set memory requests from what the process uses when idle, and leave the
  limit real headroom. Read the termination reason before guessing.
- Read the destroy plan. It shows values you never set, like the `EXTENDED`
  upgrade policy behind Bug 3.
- Apply it again after the fixes. A fix that only passed validate is the same
  kind of claim the repo started as.

The repository has the Terraform, the manifests and a runbook with every test
in this post.

{{< github repo="khadirullah/terraform-eks-monitoring" >}}
