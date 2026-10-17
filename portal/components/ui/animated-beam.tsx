'use client';

import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { type RefObject, forwardRef, useEffect, useId, useState } from 'react';

export const Icons = {
  user: () => (
    <svg
      width='24'
      height='24'
      viewBox='0 0 24 24'
      fill='none'
      stroke='#000000'
      strokeWidth='2'
      xmlns='http://www.w3.org/2000/svg'
    >
      <path d='M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2' />
      <circle cx='12' cy='7' r='4' />
    </svg>
  ),
  claude: () => (
    <svg
      width='512'
      height='512'
      viewBox='0 0 512 512'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <g clipPath='url(#clip0_2719_9)'>
        <circle cx='256.5' cy='259.5' r='259.5' fill='#CC9B7A' />
        <path
          d='M318.663 149.785H275.295L354.247 362.208L397.615 362.212L318.663 149.785ZM193.337 149.785L114.385 362.212H158.64L174.572 317.604L257.418 317.6L273.525 362.212H317.78L238.654 149.785H193.337ZM189.086 278.126L215.996 203.425L243.079 278.126H189.086Z'
          fill='#1F1F1E'
        />
      </g>
      <defs>
        <clipPath id='clip0_2719_9'>
          <rect width='512' height='512' fill='white' />
        </clipPath>
      </defs>
    </svg>
  ),
  framer: () => (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      width='24'
      height='24'
      viewBox='0 0 24 24'
      fill='currentColor'
    >
      <path d='M4 0h16v8h-8zM4 8h8l8 8H4zM4 16h8v8z' />
    </svg>
  ),
  logo: () => (
    <svg
      width='105'
      height='119'
      className='w-6 h-6'
      viewBox='0 0 105 119'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <path
        fillRule='evenodd'
        clipRule='evenodd'
        d='M0.125821 30.3477V8.11094C0.125821 5.90389 1.12007 3.97272 3.10857 2.31742C4.9645 0.772479 7.21813 0 9.86949 0H57.7925C60.9739 0 63.6915 0.938007 65.9454 2.814C68.1989 4.68999 69.3256 6.89704 69.3256 9.43514V17.7116C69.3256 20.029 69.9885 22.1809 71.3142 24.1672C72.64 26.1535 74.4959 27.6985 76.882 28.802C79.1355 30.016 81.6543 30.678 84.4383 30.7883H92.79C95.8392 30.7883 98.4904 31.6711 100.744 33.4368C102.998 35.3128 104.125 37.575 104.125 40.2235V84.6568C104.125 84.7548 104.124 84.8525 104.123 84.9499V110.67C104.123 112.936 103.129 114.92 101.14 116.62C99.2846 118.207 97.031 119 94.3795 119H46.4565C43.2751 119 40.5575 118.037 38.3037 116.11C36.0501 114.183 34.9234 111.917 34.9234 109.31V100.81C34.9234 98.4296 34.2605 96.2197 32.9348 94.1796C31.609 92.1395 29.7531 90.5528 27.3671 89.4196C25.1135 88.1728 22.5946 87.4928 19.8107 87.3795H11.459C8.40994 87.3795 5.75861 86.4728 3.50496 84.6593C1.25133 82.7328 0.124512 80.4093 0.124512 77.6894V30.6001C0.124512 30.5158 0.124949 30.4318 0.125821 30.3477ZM69.1268 85.9574V33.768C69.1268 32.9955 68.8618 32.3333 68.3314 31.7817C67.6686 31.2298 66.8732 30.9539 65.9454 30.9539H37.9075C36.9794 30.9539 36.184 31.2298 35.5212 31.7817C35.4194 31.8662 35.3255 31.9537 35.2394 32.0435L35.1222 84.3194C35.1222 85.1128 35.3872 85.7928 35.9176 86.3595C36.5805 86.926 37.3758 87.2094 38.3037 87.2094H66.3416C67.2696 87.2094 68.065 86.926 68.7279 86.3595C68.8779 86.2314 69.0109 86.0972 69.1268 85.9574Z'
        fill='black'
      />
    </svg>
  ),
  typescript: () => (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      width='24'
      height='24'
      viewBox='0 0 24 24'
    >
      <path fill='#007ACC' d='M0 0h24v24H0z' />
      <path
        fill='#fff'
        d='M13.5 10.5h3v1h-3v6h-1v-6h-3v-1h3v-1.5c0-1.5 1-2.5 2.5-2.5h1.5v1H15c-.8 0-1.5.5-1.5 1.5v1.5zM6 10.5h5v1H9v6H8v-6H6v-1z'
      />
    </svg>
  ),
  nextjs: () => (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      width='24'
      height='24'
      viewBox='0 0 24 24'
      fill='currentColor'
    >
      <path d='M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm-1.5 18.5l-5-7v7H4V5.5h1.5l5 7v-7H12v13h-1.5zm6-1.5l-1-1.5V6h1.5v9.5l3.5 5h-1.5L16.5 17z' />
    </svg>
  ),
  tailwindcss: () => (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      width='24'
      height='24'
      viewBox='0 0 24 24'
      fill='#38BDF8'
    >
      <path d='M12 6c-2.67 0-4.33 1.33-5 4 1-.67 2.17-1 3.5-1 .77 0 1.47.17 2.12.5.64.33 1.24.83 1.88 1.5C15.67 12.67 17.33 14 20 14c2.67 0 4.33-1.33 5-4-1 .67-2.17 1-3.5 1-.77 0-1.47-.17-2.12-.5-.64-.33-1.24-.83-1.88-1.5C16.33 7.33 14.67 6 12 6zM7 14c-2.67 0-4.33 1.33-5 4 1-.67 2.17-1 3.5-1 .77 0 1.47.17 2.12.5.64.33 1.24.83 1.88 1.5C10.67 20.67 12.33 22 15 22c2.67 0 4.33-1.33 5-4-1 .67-2.17 1-3.5 1-.77 0-1.47-.17-2.12-.5-.64-.33-1.24-.83-1.88-1.5C11.33 15.33 9.67 14 7 14z' />
    </svg>
  ),
  reactjs: () => (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      width='24'
      height='24'
      viewBox='0 0 24 24'
      fill='#61DAFB'
    >
      <circle cx='12' cy='12' r='2' />
      <path
        d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z'
        fill='none'
        stroke='#61DAFB'
        strokeWidth='1'
      />
      <ellipse cx='12' cy='12' rx='10' ry='4' fill='none' stroke='#61DAFB' strokeWidth='0.8' />
      <ellipse cx='12' cy='12' rx='10' ry='4' fill='none' stroke='#61DAFB' strokeWidth='0.8' transform='rotate(60 12 12)' />
      <ellipse cx='12' cy='12' rx='10' ry='4' fill='none' stroke='#61DAFB' strokeWidth='0.8' transform='rotate(120 12 12)' />
    </svg>
  ),
};

export interface AnimatedBeamProps {
  className?: string;
  containerRef: RefObject<HTMLElement | null>;
  fromRef: RefObject<HTMLElement | null>;
  toRef: RefObject<HTMLElement | null>;
  curvature?: number;
  reverse?: boolean;
  pathColor?: string;
  pathWidth?: number;
  pathOpacity?: number;
  gradientStartColor?: string;
  gradientStopColor?: string;
  delay?: number;
  duration?: number;
  startXOffset?: number;
  startYOffset?: number;
  endXOffset?: number;
  endYOffset?: number;
  dotted?: boolean;
  dotSpacing?: number;
}

const AnimatedBeam: React.FC<AnimatedBeamProps> = ({
  className,
  containerRef,
  fromRef,
  toRef,
  curvature = 0,
  reverse = false,
  duration = Math.random() * 3 + 4,
  delay = 0,
  pathColor = 'gray',
  pathWidth = 2,
  pathOpacity = 0.2,
  gradientStartColor = '#4d40ff',
  gradientStopColor = '#4043ff',
  startXOffset = 0,
  startYOffset = 0,
  endXOffset = 0,
  endYOffset = 0,
  dotted = false,
  dotSpacing = 6,
}) => {
  const id = useId();
  const [pathD, setPathD] = useState('');
  const [svgDimensions, setSvgDimensions] = useState({ width: 0, height: 0 });
  const strokeDasharray = dotted ? `${dotSpacing} ${dotSpacing}` : 'none';

  const gradientCoordinates = reverse
    ? {
        x1: ['90%', '-10%'],
        x2: ['100%', '0%'],
        y1: ['0%', '0%'],
        y2: ['0%', '0%'],
      }
    : {
        x1: ['10%', '110%'],
        x2: ['0%', '100%'],
        y1: ['0%', '0%'],
        y2: ['0%', '0%'],
      };

  useEffect(() => {
    const updatePath = () => {
      if (containerRef.current && fromRef.current && toRef.current) {
        const containerRect = containerRef.current.getBoundingClientRect();
        const rectA = fromRef.current.getBoundingClientRect();
        const rectB = toRef.current.getBoundingClientRect();
        const svgWidth = containerRect.width;
        const svgHeight = containerRect.height;
        setSvgDimensions({ width: svgWidth, height: svgHeight });
        const startX =
          rectA.left - containerRect.left + rectA.width / 2 + startXOffset;
        const startY =
          rectA.top - containerRect.top + rectA.height / 2 + startYOffset;
        const endX =
          rectB.left - containerRect.left + rectB.width / 2 + endXOffset;
        const endY =
          rectB.top - containerRect.top + rectB.height / 2 + endYOffset;
        const controlY = startY - curvature;
        const d = `M ${startX},${startY} Q ${(startX + endX) / 2},${controlY} ${endX},${endY}`;
        setPathD(d);
      }
    };

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        updatePath();
      }
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    updatePath();

    return () => {
      resizeObserver.disconnect();
    };
  }, [
    containerRef,
    fromRef,
    toRef,
    curvature,
    startXOffset,
    startYOffset,
    endXOffset,
    endYOffset,
  ]);

  return (
    <svg
      fill='none'
      width={svgDimensions.width}
      height={svgDimensions.height}
      xmlns='http://www.w3.org/2000/svg'
      className={cn(
        'pointer-events-none absolute left-0 top-0 transform-gpu stroke-2',
        className
      )}
      viewBox={`0 0 ${svgDimensions.width} ${svgDimensions.height}`}
    >
      <path
        d={pathD}
        stroke={pathColor}
        strokeWidth={pathWidth}
        strokeOpacity={pathOpacity}
        strokeLinecap='round'
        strokeDasharray={strokeDasharray}
      />
      <motion.path
        d={pathD}
        stroke={`url(#${id})`}
        strokeLinecap='round'
        strokeDasharray={strokeDasharray}
        initial={{
          strokeWidth: pathWidth,
          strokeOpacity: 0,
        }}
        animate={{
          strokeWidth: pathWidth * 1.5,
          strokeOpacity: 1,
        }}
        transition={{
          duration: 2,
          delay: delay,
        }}
      />
      <defs>
        <motion.linearGradient
          className='transform-gpu'
          id={id}
          gradientUnits={'userSpaceOnUse'}
          initial={{
            x1: '0%',
            x2: '0%',
            y1: '0%',
            y2: '0%',
          }}
          animate={{
            x1: gradientCoordinates.x1,
            x2: gradientCoordinates.x2,
            y1: gradientCoordinates.y1,
            y2: gradientCoordinates.y2,
          }}
          transition={{
            delay,
            duration,
            ease: [0.16, 1, 0.3, 1],
            repeat: Number.POSITIVE_INFINITY,
            repeatDelay: 0,
          }}
        >
          <stop stopColor={gradientStartColor} stopOpacity='0'></stop>
          <stop stopColor={gradientStartColor}></stop>
          <stop offset='32.5%' stopColor={gradientStopColor}></stop>
          <stop
            offset='100%'
            stopColor={gradientStopColor}
            stopOpacity='0'
          ></stop>
        </motion.linearGradient>
      </defs>
    </svg>
  );
};

AnimatedBeam.displayName = 'AnimatedBeam';
export { AnimatedBeam };

const Circle = forwardRef<
  HTMLDivElement,
  { className?: string; children?: React.ReactNode }
>(({ className, children }, ref) => {
  return (
    <div
      ref={ref}
      className={cn(
        'z-10 flex h-12 w-12 items-center justify-center rounded-full border-2 bg-white p-3 shadow-[0_0_20px_-12px_rgba(0,0,0,0.8)]',
        className
      )}
    >
      {children}
    </div>
  );
});
Circle.displayName = 'Circle';
export { Circle };