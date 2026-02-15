# Prompts

Gemini prompts are defined in the service layer:

- **Text metrics (humanity, integrity, rhetoric):** `app/services/gemini_service.py` — `get_text_metrics()`
- **Litmus fact-check:** `app/services/gemini_service.py` — `fact_check_claim()`
- **Link classification (Ariadne):** `app/services/gemini_service.py` — `classify_links()`
- **Oracle chat:** `app/services/gemini_service.py` — `chat_with_page()`
- **Hype-Filter headline rewrite:** `app/services/gemini_service.py` — `rewrite_headline()`
- **Chorus alternatives:** `app/services/gemini_service.py` — `chorus_alternatives()`

Tune these prompts for better accuracy or different output format. All use the configurable `GEMINI_MODEL` from config.
