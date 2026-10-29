import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MissionSelect from '../components/MissionSelect';
import type { FactionId } from '../game/factions';

vi.mock('../scene3d/FactionModels', () => ({ FactionPreview: () => null }));

describe('faction deployment menu', () => {
  it.each(['aster', 'vostran'] as const)('deploys the chosen %s faction with the other faction as AI opponent', choice => {
    const onStart = vi.fn();
    function Menu() {
      const [faction, setFaction] = useState<FactionId>('aster');
      return <MissionSelect onStart={onStart} faction={faction} onFactionChange={setFaction} />;
    }
    render(<Menu />);
    fireEvent.click(screen.getByRole('radio', { name: choice === 'aster' ? /Aster Defence Coalition/ : /Vostran Union/ }));
    expect(screen.getByRole('radio', { name: choice === 'aster' ? /Aster Defence Coalition/ : /Vostran Union/ })).toBeChecked();
    expect(screen.getByText(new RegExp(`AI opponent: ${choice === 'aster' ? 'Vostran Union' : 'Aster Defence Coalition'}`))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /DEPLOY/ }));
    expect(onStart).toHaveBeenCalledOnce();
    expect(onStart.mock.calls[0][0].id).toBe('raas');
    expect(onStart.mock.calls[0][1]).toBe(choice);
  });
});
