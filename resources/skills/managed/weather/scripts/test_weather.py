#!/usr/bin/env python3

import importlib.util
import unittest
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse


MODULE_PATH = Path(__file__).with_name("weather.py")
SPEC = importlib.util.spec_from_file_location("managed_weather", MODULE_PATH)
assert SPEC and SPEC.loader
weather = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(weather)


def geocoding_payload():
    return {
        "results": [
            {
                "name": "厦门市",
                "admin1": "福建省",
                "country": "中国",
                "latitude": 24.47979,
                "longitude": 118.08187,
                "timezone": "Asia/Shanghai",
            }
        ]
    }


def forecast_payload():
    return {
        "timezone": "Asia/Shanghai",
        "current": {
            "time": "2026-07-31T15:00",
            "temperature_2m": 31.2,
            "apparent_temperature": 35.1,
            "relative_humidity_2m": 68,
            "precipitation": 0,
            "weather_code": 2,
            "wind_speed_10m": 12.4,
        },
        "daily": {
            "time": ["2026-07-31", "2026-08-01"],
            "weather_code": [80, 2],
            "temperature_2m_max": [33.1, 34.0],
            "temperature_2m_min": [26.4, 27.0],
            "precipitation_probability_max": [70, 20],
        },
    }


def wttr_payload():
    return {
        "nearest_area": [
            {
                "areaName": [{"value": "Xiamen"}],
                "region": [{"value": "Fujian"}],
                "country": [{"value": "China"}],
            }
        ],
        "current_condition": [
            {
                "temp_C": "30",
                "FeelsLikeC": "34",
                "humidity": "70",
                "precipMM": "0.0",
                "windspeedKmph": "10",
                "weatherDesc": [{"value": "Partly cloudy"}],
            }
        ],
        "weather": [
            {
                "date": "2026-07-31",
                "maxtempC": "33",
                "mintempC": "26",
                "hourly": [
                    {
                        "chanceofrain": "40",
                        "weatherDesc": [{"value": "Cloudy"}],
                    }
                ],
            }
        ],
    }


class WeatherTest(unittest.TestCase):
    def test_open_meteo_is_the_primary_provider(self):
        calls = []

        def fetcher(url, _timeout):
            calls.append(url)
            if url.startswith(weather.GEOCODING_URL):
                return geocoding_payload()
            if url.startswith(weather.FORECAST_URL):
                return forecast_payload()
            self.fail(f"unexpected URL: {url}")

        result = weather.lookup_weather("Xiamen", 2, fetcher)

        self.assertEqual(result["source"], "open-meteo")
        self.assertEqual(result["location"], "厦门市，福建省，中国")
        self.assertEqual(result["forecast"][0]["condition"], "小阵雨")
        self.assertEqual(len(calls), 2)
        self.assertTrue(calls[0].startswith(weather.GEOCODING_URL))

    def test_chinese_city_suffix_is_retried(self):
        queries = []

        def fetcher(url, _timeout):
            if url.startswith(weather.GEOCODING_URL):
                query = parse_qs(urlparse(url).query)["name"][0]
                queries.append(query)
                return {} if query == "厦门" else geocoding_payload()
            return forecast_payload()

        result = weather.lookup_weather("厦门", 1, fetcher)

        self.assertEqual(result["source"], "open-meteo")
        self.assertEqual(queries, ["厦门", "厦门市"])

    def test_wttr_is_used_after_open_meteo_failure(self):
        def fetcher(url, _timeout):
            if url.startswith(weather.GEOCODING_URL):
                raise weather.WeatherLookupError("geocoder unavailable")
            if url.startswith(weather.WTTR_URL):
                self.assertEqual(unquote(urlparse(url).path), "/厦门")
                return wttr_payload()
            self.fail(f"unexpected URL: {url}")

        result = weather.lookup_weather("厦门", 1, fetcher)

        self.assertEqual(result["source"], "wttr.in")
        self.assertIn("geocoder unavailable", result["fallbackReason"])
        self.assertEqual(result["forecast"][0]["temperatureMaxC"], 33.0)

    def test_combines_provider_errors_when_both_fail(self):
        def fetcher(url, _timeout):
            provider = "open-meteo" if "open-meteo" in url else "wttr"
            raise weather.WeatherLookupError(f"{provider} timeout")

        with self.assertRaisesRegex(
            weather.WeatherLookupError,
            r"Open-Meteo failed: open-meteo timeout; wttr\.in failed: wttr timeout",
        ):
            weather.lookup_weather("厦门", 1, fetcher)

    def test_rejects_invalid_forecast_days(self):
        with self.assertRaisesRegex(ValueError, "between 1 and 7"):
            weather.lookup_weather("厦门", 8, lambda _url, _timeout: {})


if __name__ == "__main__":
    unittest.main()
