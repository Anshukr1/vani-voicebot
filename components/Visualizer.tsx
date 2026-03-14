import React, { useEffect, useRef } from 'react';

interface VisualizerProps {
  isActive: boolean;
  mode: 'listening' | 'speaking' | 'idle';
}

const Visualizer: React.FC<VisualizerProps> = ({ isActive, mode }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let time = 0;
    const width = canvas.width;
    const height = canvas.height;

    const animate = () => {
      ctx.clearRect(0, 0, width, height);
      
      if (isActive) {
        time += 0.05;
        
        const color = mode === 'listening' ? '#ef4444' : '#6366f1'; // Red for listening, Indigo for speaking
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        
        const centerY = height / 2;
        
        ctx.beginPath();
        for (let x = 0; x < width; x++) {
          // Create a wave effect
          const frequency = mode === 'listening' ? 0.05 : 0.03;
          const amplitude = mode === 'listening' 
            ? Math.sin(time * 2) * 15 + 20 
            : Math.sin(time * 3) * 10 + 15;
            
          const y = centerY + Math.sin(x * frequency + time) * 
                   Math.cos(x * 0.02 + time) * amplitude;
                   
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      } else {
        // Idle line
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [isActive, mode]);

  return (
    <canvas 
      ref={canvasRef} 
      width={300} 
      height={80} 
      className="w-full h-20 rounded-lg bg-slate-900/50 backdrop-blur-sm"
    />
  );
};

export default Visualizer;