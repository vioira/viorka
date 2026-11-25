"""Forward Go test output to the CI log and write timing tables to stdout."""

import json
import sys


def main():
    groups = {"Packages": [], "Top-level tests": [], "Subtests": []}
    for line in sys.stdin:
        event = json.loads(line)
        if "Output" in event:
            sys.stderr.write(event["Output"])
        if event["Action"] not in ("pass", "fail") or "Elapsed" not in event:
            continue
        package = event["Package"]
        test = event.get("Test", "")
        if not test:
            group = "Packages"
        elif "/" in test:
            group = "Subtests"
        else:
            group = "Top-level tests"
        name = f"{package}/{test}" if test else package
        groups[group].append((event["Elapsed"], name))

    print("## Go race test timings")
    print("\nParent durations include their subtests. Times may overlap across packages.")
    for group, entries in groups.items():
        if entries:
            print(f"\n### {group} (slowest 10)\n")
            print("| Seconds | Name |\n| ---: | --- |")
            for elapsed, name in sorted(entries, reverse=True)[:10]:
                name = name.replace("|", "\\|")
                print(f"| {elapsed:.3f} | `{name}` |")


if __name__ == "__main__":
    main()
