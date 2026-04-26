from celery import shared_task

from .services import get_pending_payout_ids, process_payout_attempt, retry_or_fail_stuck_payouts


@shared_task(name="apps.payouts.tasks.process_pending_payout")
def process_pending_payout(payout_id: str) -> None:
    process_payout_attempt(payout_id=payout_id)


@shared_task(name="apps.payouts.tasks.enqueue_pending_payouts")
def enqueue_pending_payouts() -> None:
    for payout_id in get_pending_payout_ids():
        process_pending_payout.delay(str(payout_id))


@shared_task(name="apps.payouts.tasks.retry_stuck_payouts")
def retry_stuck_payouts() -> None:
    for payout_id in retry_or_fail_stuck_payouts():
        process_pending_payout.delay(payout_id)