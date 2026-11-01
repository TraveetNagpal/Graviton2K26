import json
import logging
from unittest.mock import patch

import pytest

from app.services.earth_engine.client import EarthEngineClient
from app.services.earth_engine.errors import EarthEngineAuthenticationError
from app.services.earth_engine.settings import EarthEngineSettings


def test_service_account_json_identity_and_project_are_passed_to_earth_engine():
    key_data = json.dumps({
        "client_email": "unit-test-account@example.invalid",
        "private_key": "unit-test-private-key",
    })
    client = EarthEngineClient(EarthEngineSettings(
        _env_file=None, EE_PROJECT_ID="unit-test-project", EE_SERVICE_ACCOUNT_KEY_JSON=key_data,
    ))
    credentials = object()

    with patch("app.services.earth_engine.client.ee.ServiceAccountCredentials", return_value=credentials) as service_account, \
            patch("app.services.earth_engine.client.ee.Initialize") as initialize:
        client.initialize()

    service_account.assert_called_once_with("unit-test-account@example.invalid", key_data=key_data)
    initialize.assert_called_once_with(credentials, project="unit-test-project")


def test_initialization_log_reports_cause_without_service_account_secrets(caplog):
    private_key = "unit-test-private-key-value"
    email = "unit-test-account@example.invalid"
    key_data = json.dumps({"client_email": email, "private_key": private_key})
    client = EarthEngineClient(EarthEngineSettings(
        _env_file=None, EE_PROJECT_ID="unit-test-project", EE_SERVICE_ACCOUNT_KEY_JSON=key_data,
    ))
    caplog.set_level(logging.ERROR, logger="app.services.earth_engine.client")

    with patch(
        "app.services.earth_engine.client.ee.ServiceAccountCredentials",
        side_effect=RuntimeError(f"invalid_grant for {email} {private_key}"),
    ), pytest.raises(EarthEngineAuthenticationError):
        client.initialize()

    assert "RuntimeError" in caplog.text
    assert "invalid_grant" in caplog.text
    assert email not in caplog.text
    assert private_key not in caplog.text
    assert key_data not in caplog.text
