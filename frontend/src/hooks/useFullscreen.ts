import { useCallback, useEffect, useState, type RefObject } from 'react';

export function useFullscreen(targetRef: RefObject<HTMLElement>) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handleChange = () => {
      setIsFullscreen(document.fullscreenElement === targetRef.current);
    };

    document.addEventListener('fullscreenchange', handleChange);
    return () => document.removeEventListener('fullscreenchange', handleChange);
  }, [targetRef]);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement === targetRef.current) {
        await document.exitFullscreen();
        return;
      }
      await targetRef.current?.requestFullscreen();
    } catch (error) {
      console.warn('Full-screen mode is unavailable:', error);
    }
  }, [targetRef]);

  return { isFullscreen, toggleFullscreen };
}
