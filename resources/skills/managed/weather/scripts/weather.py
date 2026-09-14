#!/usr/bin/env python3
"""Fetch current weather and short forecasts with a provider fallback."""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections.abc import Callable
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen


USER_AGENT = "weiling-ai-assistant/0.1"
DEFAULT_TIMEOUT_SECONDS = 10.0
MAX_FORECAST_DAYS = 7

GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
WTTR_URL = "https://wttr.in"

WEATHER_CODES = {
    0: "晴",
    1: "大部晴朗",
    2: "局部多云",
    3: "阴",
    45: "雾",
    48: "雾凇",
    51: "小毛毛雨",
    53: "毛毛雨",
    55: "大毛毛雨",
    56: "轻微冻毛毛雨",
    57: "强冻毛毛雨",
    61: "小雨",
    63: "中雨",
    65: "大雨",
    66: "轻微冻雨",
    67: "强冻雨",
    71: "小雪",
    73: "中雪",
    75: "大雪",
    77: "米雪",
    80: "小阵雨",
    81: "阵雨",
    82: "强阵雨",
    85: "小阵雪",
    86: "强阵雪",
    95: "雷暴",
    96: "雷暴伴小冰雹",
    99: "雷暴伴大冰雹",
}


class WeatherLookupError(RuntimeError):
    """Raised when a weather provider cannot return usable data."""


JsonFetcher = Callable[[str, float], dict[str, Any]]


def fetch_json(url: str, timeout: float = DEFAULT_TIMEOUT_SECONDS) -> dict[str, Any]:
    request = Request(url, headers={"Accept": "application/json", "User-Agent": USER_AGENT})
    try:
        with urlopen(request, timeout=timeout) as response:
            status = getattr(response, "status", 200)
            if status < 200 or status >= 300:
                raise WeatherLookupError(f"HTTP {status}")
            payload = json.load(response)
    except (HTTPError, URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
        raise WeatherLookupError(str(exc)) from exc
    if not isinstance(payload, dict):
        raise WeatherLookupError("response is not a JSON object")
    return payload


def location_candidates(location: str) -> list[str]:
    candidate = location.strip()
    if not candidate:
        raise ValueError("location must not be empty")
    if len(candidate) > 120 or any(char in candidate for char in "\r\n\x00"):
        raise ValueError("location must be a single line up to 120 characters")
    candidates = [candidate]
    if re.fullmatch(r"[\u3400-\u9fff]{2,12}", candidate) and not candidate.endswith(
        ("市", "县", "区", "州", "盟", "旗")
    ):
        candidates.append(f"{candidate}市")
    return candidates


def build_url(base: str, params: dict[str, object]) -> str:
    return f"{base}?{urlencode(params)}"


def geocode_location(location: str, fetcher: JsonFetcher) -> dict[str, Any]:
    for candidate in location_candidates(location):
        payload = fetcher(
            build_url(
                GEOCODING_URL,
                {"name": candidate, "count": 5, "language": "zh", "format": "json"},
            ),
            DEFAULT_TIMEOUT_SECONDS,
        )
        results = payload.get("results")
        if isinstance(results, list) and results and isinstance(results[0], dict):
            result = results[0]
            if isinstance(result.get("latitude"), (int, float)) and isinstance(
                result.get("longitude"), (int, float)
            ):
                return result
    raise WeatherLookupError(f"Open-Meteo cannot resolve location: {location}")


def weather_description(value: object) -> str:
    try:
        code = int(value)
    except (TypeError, ValueError):
        return "天气状况未知"
    return WEATHER_CODES.get(code, f"天气代码 {code}")


def sequence_value(value: object, index: int) -> object | None:
    if isinstance(value, list) and 0 <= index < len(value):
        return value[index]
    return None


def number_or_none(value: object) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value))
    except (TypeError, ValueError):
        return None


def open_meteo_lookup(
    location: str, days: int, fetcher: JsonFetcher = fetch_json
) -> dict[str, Any]:
    place = geocode_location(location, fetcher)
    payload = fetcher(
        build_url(
            FORECAST_URL,
            {
                "latitude": place["latitude"],
                "longitude": place["longitude"],
                "timezone": "auto",
                "forecast_days": days,
                "current": (
                    "temperature_2m,apparent_temperature,relative_humidity_2m,"
                    "precipitation,weather_code,wind_speed_10m"
                ),
                "daily": (
                    "weather_code,temperature_2m_max,temperature_2m_min,"
                    "precipitation_probability_max"
                ),
            },
        ),
        DEFAULT_TIMEOUT_SECONDS,
    )
    current = payload.get("current")
    daily = payload.get("daily")
    if not isinstance(current, dict) or not isinstance(daily, dict):
        raise WeatherLookupError("Open-Meteo response is missing current or daily data")
    dates = daily.get("time")
    if not isinstance(dates, list) or not dates:
        raise WeatherLookupError("Open-Meteo response has no forecast dates")

    forecast = []
    for index, date in enumerate(dates[:days]):
        forecast.append(
            {
                "date": str(date),
                "condition": weather_description(sequence_value(daily.get("weather_code"), index)),
                "temperatureMaxC": number_or_none(
                    sequence_value(daily.get("temperature_2m_max"), index)
                ),
                "temperatureMinC": number_or_none(
                    sequence_value(daily.get("temperature_2m_min"), index)
                ),
                "precipitationProbabilityPercent": number_or_none(
                    sequence_value(daily.get("precipitation_probability_max"), index)
                ),
            }
        )

    resolved_parts = [str(place.get("name") or location)]
    for field in ("admin1", "country"):
        value = place.get(field)
        if isinstance(value, str) and value and value not in resolved_parts:
            resolved_parts.append(value)
    return {
        "ok": True,
        "source": "open-meteo",
        "query": location,
        "location": "，".join(resolved_parts),
        "timezone": payload.get("timezone") or place.get("timezone"),
        "current": {
            "time": current.get("time"),
            "condition": weather_description(current.get("weather_code")),
            "temperatureC": number_or_none(current.get("temperature_2m")),
            "apparentTemperatureC": number_or_none(current.get("apparent_temperature")),
            "humidityPercent": number_or_none(current.get("relative_humidity_2m")),
            "precipitationMm": number_or_none(current.get("precipitation")),
            "windSpeedKmh": number_or_none(current.get("wind_speed_10m")),
        },
        "forecast": forecast,
    }


def wttr_lookup(location: str, days: int, fetcher: JsonFetcher = fetch_json) -> dict[str, Any]:
    url = f"{WTTR_URL}/{quote(location.strip(), safe='')}?format=j1"
    payload = fetcher(url, DEFAULT_TIMEOUT_SECONDS)
    nearest = payload.get("nearest_area")
    current_rows = payload.get("current_condition")
    weather_rows = payload.get("weather")
    if not isinstance(current_rows, list) or not current_rows or not isinstance(current_rows[0], dict):
        raise WeatherLookupError("wttr.in response has no current conditions")
    if not isinstance(weather_rows, list) or not weather_rows:
        raise WeatherLookupError("wttr.in response has no forecast")

    def text_field(row: dict[str, Any], field: str) -> str | None:
        values = row.get(field)
        if isinstance(values, list) and values and isinstance(values[0], dict):
            value = values[0].get("value")
            return str(value) if value else None
        return None

    resolved = location
    if isinstance(nearest, list) and nearest and isinstance(nearest[0], dict):
        area = text_field(nearest[0], "areaName")
        region = text_field(nearest[0], "region")
        country = text_field(nearest[0], "country")
        resolved = "，".join(value for value in (area, region, country) if value) or location

    current_row = current_rows[0]
    forecast = []
    for row in weather_rows[:days]:
        if not isinstance(row, dict):
            continue
        hourly = row.get("hourly")
        representative = hourly[len(hourly) // 2] if isinstance(hourly, list) and hourly else {}
        description = text_field(representative, "lang_zh") or text_field(
            representative, "weatherDesc"
        )
        forecast.append(
            {
                "date": str(row.get("date") or ""),
                "condition": description or "天气状况未知",
                "temperatureMaxC": number_or_none(row.get("maxtempC")),
                "temperatureMinC": number_or_none(row.get("mintempC")),
                "precipitationProbabilityPercent": number_or_none(
                    representative.get("chanceofrain") if isinstance(representative, dict) else None
                ),
            }
        )
    if not forecast:
        raise WeatherLookupError("wttr.in response has no usable forecast")

    current_description = text_field(current_row, "lang_zh") or text_field(
        current_row, "weatherDesc"
    )
    return {
        "ok": True,
        "source": "wttr.in",
        "query": location,
        "location": resolved,
        "timezone": None,
        "current": {
            "time": current_row.get("localObsDateTime") or current_row.get("observation_time"),
            "condition": current_description or "天气状况未知",
            "temperatureC": number_or_none(current_row.get("temp_C")),
            "apparentTemperatureC": number_or_none(current_row.get("FeelsLikeC")),
            "humidityPercent": number_or_none(current_row.get("humidity")),
            "precipitationMm": number_or_none(current_row.get("precipMM")),
            "windSpeedKmh": number_or_none(current_row.get("windspeedKmph")),
        },
        "forecast": forecast,
    }


def lookup_weather(
    location: str, days: int, fetcher: JsonFetcher = fetch_json
) -> dict[str, Any]:
    if days < 1 or days > MAX_FORECAST_DAYS:
        raise ValueError(f"days must be between 1 and {MAX_FORECAST_DAYS}")
    primary_error: WeatherLookupError | None = None
    try:
        return open_meteo_lookup(location, days, fetcher)
    except WeatherLookupError as exc:
        primary_error = exc
    try:
        result = wttr_lookup(location, days, fetcher)
        result["fallbackReason"] = str(primary_error)
        return result
    except WeatherLookupError as fallback_error:
        raise WeatherLookupError(
            f"Open-Meteo failed: {primary_error}; wttr.in failed: {fallback_error}"
        ) from fallback_error


def format_number(value: object, suffix: str = "") -> str:
    number = number_or_none(value)
    if number is None:
        return "未知"
    rendered = str(int(number)) if number.is_integer() else f"{number:.1f}"
    return f"{rendered}{suffix}"


def render_text(result: dict[str, Any]) -> str:
    current = result["current"]
    lines = [
        f"{result['location']}（数据源：{result['source']}）",
        (
            f"当前：{current['condition']}，{format_number(current['temperatureC'], '°C')}，"
            f"体感 {format_number(current['apparentTemperatureC'], '°C')}，"
            f"湿度 {format_number(current['humidityPercent'], '%')}，"
            f"风速 {format_number(current['windSpeedKmh'], ' km/h')}"
        ),
    ]
    for day in result["forecast"]:
        rain = format_number(day.get("precipitationProbabilityPercent"), "%")
        lines.append(
            f"{day['date']}：{day['condition']}，"
            f"{format_number(day.get('temperatureMinC'), '°C')}~"
            f"{format_number(day.get('temperatureMaxC'), '°C')}，降雨概率 {rain}"
        )
    return "\n".join(lines)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("location", help="city, region, or airport code")
    parser.add_argument("--days", type=int, default=1, help="forecast days (1-7)")
    parser.add_argument("--json", action="store_true", help="print structured JSON")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        result = lookup_weather(args.location, args.days)
    except (ValueError, WeatherLookupError) as exc:
        error = {"ok": False, "error": str(exc)}
        print(json.dumps(error, ensure_ascii=False) if args.json else f"天气查询失败：{exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2) if args.json else render_text(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
