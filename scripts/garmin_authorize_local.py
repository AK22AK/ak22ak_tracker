#!/usr/bin/env python3
"""Create a Garmin token-only import file entirely on the user's Mac."""

from __future__ import annotations

import argparse
import getpass
import json
import logging
import os
from pathlib import Path
from typing import Any


CLIENT_ID = "python-garminconnect"
CLIENT_VERSION = "0.3.6"
TOKEN_KEYS = {"di_token", "di_refresh_token", "di_client_id"}
DEFAULT_OUTPUT = Path.home() / ".ak22ak_tracker" / "garmin-token-bundle.json"


def build_envelope(token_bundle: str, region: str) -> dict[str, Any]:
    try:
        tokens = json.loads(token_bundle)
    except json.JSONDecodeError as error:
        raise ValueError("invalid_token_bundle") from error
    if not isinstance(tokens, dict) or set(tokens) != TOKEN_KEYS:
        raise ValueError("invalid_token_bundle")
    if not all(isinstance(tokens[key], str) and tokens[key] for key in TOKEN_KEYS):
        raise ValueError("invalid_token_bundle")
    if region not in {"global", "china"}:
        raise ValueError("invalid_region")
    return {
        "schemaVersion": 1,
        "client": CLIENT_ID,
        "clientVersion": CLIENT_VERSION,
        "region": region,
        "tokenBundle": json.dumps(tokens, separators=(",", ":")),
    }


def write_private_json(path: Path, value: dict[str, Any]) -> None:
    path = path.expanduser().absolute()
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    path.parent.chmod(0o700)
    def private_opener(name: str, flags: int) -> int:
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        return os.open(name, flags, 0o600)

    with open(path, "w", encoding="utf-8", opener=private_opener) as output:
        json.dump(value, output, ensure_ascii=False, separators=(",", ":"))
        output.write("\n")
    path.chmod(0o600)


def authorize(region: str) -> dict[str, Any]:
    try:
        from garminconnect import Garmin  # type: ignore[import-not-found]
    except ImportError as error:
        raise RuntimeError("garmin_client_not_installed") from error

    email = input("Garmin 账号邮箱：").strip()
    password = getpass.getpass("Garmin 密码（仅本机使用）：")
    if not email or not password:
        raise RuntimeError("credentials_missing")
    garmin = Garmin(
        email,
        password,
        is_cn=region == "china",
        prompt_mfa=lambda: getpass.getpass("Garmin MFA 验证码：").strip(),
        retry_attempts=0,
    )
    try:
        garmin.login()
        token_bundle = garmin.client.dumps()
    finally:
        password = ""
    return build_envelope(token_bundle, region)


def temporary_file_guidance(
    output: Path, default_output: Path = DEFAULT_OUTPUT
) -> tuple[str, ...]:
    messages = [
        "这是临时导入凭证。请在设置页确认导入成功后删除本机文件。",
    ]
    if output.expanduser().absolute() == default_output.expanduser().absolute():
        messages.append(
            "默认文件可在导入成功后删除：rm ~/.ak22ak_tracker/garmin-token-bundle.json"
        )
    else:
        messages.append("你使用了自定义输出位置，请在导入成功后手动删除该文件。")
    messages.append(
        "不要长期保留，不要同步到 iCloud 或云盘，不要发送到聊天，也不要复制进仓库。"
    )
    return tuple(messages)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="在本机登录 Garmin，并生成可导入 AK Tracker 的 token 文件。"
    )
    parser.add_argument("--region", choices=("global", "china"), default="global")
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
    )
    args = parser.parse_args()
    logging.disable(logging.CRITICAL)
    try:
        envelope = authorize(args.region)
        write_private_json(args.output, envelope)
    except Exception:
        print("授权未完成。未生成或更新 token 文件。")
        return 1
    print(f"授权完成。token 文件已保存到：{args.output.expanduser().absolute()}")
    print("请在 AK Tracker 设置页选择该文件。")
    for message in temporary_file_guidance(args.output):
        print(message)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
