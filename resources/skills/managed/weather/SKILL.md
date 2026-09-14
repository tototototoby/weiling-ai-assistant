---
name: "weather"
description: "Get current weather and forecasts through a resilient Open-Meteo-first lookup with a wttr.in fallback. Use when the user asks about weather, temperature, rain, or forecasts for a location. No API key is required."
---

# Weather

Use the bundled script for current conditions and forecasts. It queries Open-Meteo first and automatically falls back to wttr.in when geocoding or forecast retrieval fails.

## Required Workflow

1. Identify a city, region, or airport code from the user's message or established context.
2. Run the script from this Skill directory:

   ```bash
   python3 scripts/weather.py "Xiamen"
   ```

3. For a multi-day forecast, request up to seven days:

   ```bash
   python3 scripts/weather.py "Shanghai" --days 3
   ```

4. Use structured output only when another tool or workflow needs it:

   ```bash
   python3 scripts/weather.py "Beijing" --days 3 --json
   ```

5. Answer with the resolved location, forecast date, conditions, temperature range, rain probability, and a short practical note when relevant.

If the location is missing and cannot be inferred safely, ask for the city. Do not invent weather data. When the script reports that both providers failed, state that the live weather service is temporarily unavailable and offer to retry.

## Scope

Use this Skill for:

- Current weather and temperature
- Rain checks for today or tomorrow
- Short forecasts of up to seven days
- Basic travel and commute weather checks

Do not use it for:

- Historical weather or climate analysis
- Official severe-weather warnings
- Aviation or marine weather
- Hyper-local sensor readings

For safety-critical warnings, direct the user to the relevant local meteorological authority.

## Runtime Notes

- Requires Python 3 only; the implementation uses the Python standard library.
- Open-Meteo geocoding and forecast APIs are the primary provider.
- wttr.in JSON is a best-effort fallback and may be rate limited.
- Network calls use bounded timeouts and a descriptive User-Agent.
