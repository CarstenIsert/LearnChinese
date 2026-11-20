import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, LogOut, User, UserPlus } from 'lucide-react';
import { AuthUser } from '../types.ts';

interface UserMenuProps {
  user: AuthUser;
  onOpenInvites: () => void;
  onLogout: () => void;
}

export function UserMenu({ user, onOpenInvites, onLogout }: UserMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div className="user-menu" ref={menuRef}>
      <button
        type="button"
        className="user-menu-trigger"
        aria-expanded={isOpen}
        aria-haspopup="menu"
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <User size={14} aria-hidden="true" />
        <span>{user.displayName}</span>
        <ChevronDown size={14} aria-hidden="true" className={isOpen ? 'is-rotated' : ''} />
      </button>

      {isOpen && (
        <div className="user-menu-dropdown" role="menu">
          <div className="user-menu-meta">
            <span className="user-menu-email">{user.email}</span>
            {user.role === 'admin' && <span className="user-menu-role">Admin</span>}
          </div>

          {user.role === 'admin' && (
            <button
              type="button"
              role="menuitem"
              className="user-menu-item"
              onClick={() => {
                setIsOpen(false);
                onOpenInvites();
              }}
            >
              <UserPlus size={15} aria-hidden="true" />
              Einladen
            </button>
          )}

          <button
            type="button"
            role="menuitem"
            className="user-menu-item is-danger"
            onClick={() => {
              setIsOpen(false);
              onLogout();
            }}
          >
            <LogOut size={15} aria-hidden="true" />
            Abmelden
          </button>
        </div>
      )}
    </div>
  );
}
