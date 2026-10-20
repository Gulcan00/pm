import sys

from app.openrouter import OpenRouterError, check_connectivity


def main() -> int:
    try:
        answer = check_connectivity()
    except OpenRouterError as error:
        print(str(error), file=sys.stderr)
        return 1
    print(answer)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())