import json
from sqlalchemy.orm import Session

from backend.models import Role


def seed_database(db: Session) -> None:
    """Initialize only system RBAC roles. Zero fake patient or surveillance records are seeded."""
    if db.query(Role).count() == 0:
        roles = [
            Role(
                name="patient",
                description="Personal health vault owner",
                permissions_json=json.dumps(["vault:rw", "assistant:rw", "summary:read", "shares:rw"]),
            ),
            Role(
                name="doctor",
                description="Authorized clinician viewing explicitly shared records",
                permissions_json=json.dumps(["shares:view_assigned", "summary:view_shared"]),
            ),
            Role(
                name="admin",
                description="Public health surveillance & outbreak administrator",
                permissions_json=json.dumps(["outbreak:read", "outbreak:sync", "ml:train", "simulator:rw", "alerts:rw"]),
            ),
        ]
        db.add_all(roles)
        db.commit()
