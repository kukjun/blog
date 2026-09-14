#!/usr/bin/env python3
"""Synthetic token ledger, not an API call or an observed production bill.

Run with Python 3.10+: python3 prompt-cache-cost.py
Rates: Claude API Sonnet 4.5 standard USD/MTok, checked 2026-09-14.
https://platform.claude.com/docs/en/about-claude/pricing
No Batch, geography premium, taxes, tool charges, or negotiated discounts.
"""

from dataclasses import dataclass
from decimal import Decimal as D


@dataclass(frozen=True)
class Usage:
    uncached: int = 0
    write_5m: int = 0
    write_1h: int = 0
    read: int = 0
    output: int = 0

    def __post_init__(self):
        for value in vars(self).values():
            if type(value) is not int or value < 0:
                raise ValueError("token counts must be nonnegative integers")

    @property
    def input_total(self):
        return self.uncached + self.write_5m + self.write_1h + self.read


@dataclass(frozen=True)
class Rates:
    uncached: D = D("3")
    write_5m: D = D("3.75")
    write_1h: D = D("6")
    read: D = D("0.30")
    output: D = D("15")


RATES = Rates()
MILLION = D("1000000")


def cached_cost(usage, rates=RATES):
    return sum(
        (D(getattr(usage, key)) * getattr(rates, key) for key in vars(usage)),
        D("0"),
    ) / MILLION


def without_cache(usage, rates=RATES):
    return (D(usage.input_total) * rates.uncached + D(usage.output) * rates.output) / MILLION


def from_claude_usage(raw):
    """Normalize an ordinary Claude Messages usage object with explicit TTL detail.

    Does not accept aggregated streaming events, Bedrock Converse fields, or
    service tool usage. Missing TTL detail for nonzero writes is an error.
    """
    total_write = raw["cache_creation_input_tokens"]
    details = raw.get("cache_creation")
    if details is None:
        if total_write != 0:
            raise ValueError("TTL split required for nonzero cache writes")
        w5 = w1 = 0
    else:
        w5 = details["ephemeral_5m_input_tokens"]
        w1 = details["ephemeral_1h_input_tokens"]
    if type(total_write) is not int or total_write < 0 or w5 + w1 != total_write:
        raise ValueError("cache creation total and TTL split disagree")
    return Usage(raw["input_tokens"], w5, w1, raw["cache_read_input_tokens"], raw["output_tokens"])


def print_case(name, usage):
    actual = cached_cost(usage)
    baseline = without_cache(usage)
    change = actual - baseline
    print(f"{name}: cached=${actual:.3f}, no_cache=${baseline:.3f}, delta=${change:+.3f}")


def main():
    # The same 100 synthetic requests: 1,000 uncached + 10,000 prefix + 200 output tokens each.
    cases = {
        "all_miss_1h": Usage(100_000, 0, 1_000_000, 0, 20_000),
        "one_write_99_reads": Usage(100_000, 0, 10_000, 990_000, 20_000),
        "mixed_ttl": Usage(100_000, 80_000, 20_000, 900_000, 20_000),
    }
    expected = [D("6.600"), D("0.957"), D("1.290")]
    for (name, usage), cost in zip(cases.items(), expected):
        assert usage.input_total == 1_100_000
        assert cached_cost(usage) == cost
        assert without_cache(usage) == D("3.600")
        print_case(name, usage)

    # Two-request observation windows with the read prefix already cached before each window.
    # Earlier cache creation is outside these ledgers: not full cache-lifetime cost comparisons.
    # Exactly one hit request and one write request in either window: request hit rate = 50%.
    for name, usage, expected_cost in (
        ("large_hit_small_miss", Usage(read=100_000, write_1h=10_000), D("0.090")),
        ("small_hit_large_miss", Usage(read=10_000, write_1h=100_000), D("0.603")),
    ):
        assert cached_cost(usage) == expected_cost
        assert without_cache(usage) == D("0.330")
        print_case(name, usage)

    # Fieldwise sum of the 100 synthetic usage objects, each with 11,000 input tokens.
    # Not a single million-token API request.
    raw = {
        "input_tokens": 100_000,
        "cache_creation_input_tokens": 100_000,
        "cache_creation": {
            "ephemeral_5m_input_tokens": 80_000,
            "ephemeral_1h_input_tokens": 20_000,
        },
        "cache_read_input_tokens": 900_000,
        "output_tokens": 20_000,
    }
    assert from_claude_usage(raw) == cases["mixed_ttl"]
    missing_ttl = {key: value for key, value in raw.items() if key != "cache_creation"}
    wrong_total = {**raw, "cache_creation_input_tokens": 99_999}
    for bad in (missing_ttl, wrong_total):
        try:
            from_claude_usage(bad)
        except ValueError:
            pass
        else:
            raise AssertionError("ambiguous usage must not be priced")

    # A single 10,000-token prefix, one initial write, then n reads before expiry.
    for write_rate, first_cheaper_n in ((RATES.write_5m, 1), (RATES.write_1h, 2)):
        for n in range(4):
            cached = write_rate + D(n) * RATES.read
            ordinary = D(n + 1) * RATES.uncached
            assert (cached < ordinary) == (n >= first_cheaper_n)
    print("PASS: baseline, mixed TTL, hit-rate counterexample, usage validation, break-even")


if __name__ == "__main__":
    main()
