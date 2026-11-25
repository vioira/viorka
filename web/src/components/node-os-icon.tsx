import { Monitor } from 'lucide-react';
import alibaba from '@/assets/os-icons/alibaba.svg';
import almalinux from '@/assets/os-icons/almalinux.svg';
import alpinelinux from '@/assets/os-icons/alpinelinux.svg';
import apple from '@/assets/os-icons/apple.svg';
import archlinux from '@/assets/os-icons/archlinux.svg';
import armbian from '@/assets/os-icons/armbian.png';
import centos from '@/assets/os-icons/centos.svg';
import debian from '@/assets/os-icons/debian.svg';
import fedora from '@/assets/os-icons/fedora.svg';
import gentoo from '@/assets/os-icons/gentoo.svg';
import istoreos from '@/assets/os-icons/istoreos.png';
import kali from '@/assets/os-icons/kali.svg';
import linux from '@/assets/os-icons/linux.svg';
import linuxmint from '@/assets/os-icons/linuxmint.svg';
import manjaro from '@/assets/os-icons/manjaro.svg';
import nixos from '@/assets/os-icons/nixos.svg';
import opencloudos from '@/assets/os-icons/opencloudos.svg';
import opensuse from '@/assets/os-icons/opensuse.svg';
import openwrt from '@/assets/os-icons/openwrt.svg';
import oracle from '@/assets/os-icons/oracle.svg';
import proxmox from '@/assets/os-icons/proxmox.png';
import redhat from '@/assets/os-icons/redhat.svg';
import rockylinux from '@/assets/os-icons/rockylinux.svg';
import synology from '@/assets/os-icons/synology.png';
import ubuntu from '@/assets/os-icons/ubuntu.svg';
import windows11 from '@/assets/os-icons/windows11.svg';

const systems: [RegExp, string, string][] = [
  [/\b(?:alibaba|alinux)\b/i, alibaba, 'Alibaba Cloud Linux'],
  [/\barmbian/i, armbian, 'Armbian'],
  [/\bistore/i, istoreos, 'iStoreOS'],
  [/\bkali/i, kali, 'Kali Linux'],
  [/\bmanjaro/i, manjaro, 'Manjaro'],
  [/\b(?:linux\s*)?mint\b/i, linuxmint, 'Linux Mint'],
  [/\bopencloud/i, opencloudos, 'OpenCloudOS'],
  [/\bopenwrt/i, openwrt, 'OpenWrt'],
  [/\boracle/i, oracle, 'Oracle Linux'],
  [/\b(?:proxmox|pve)\b/i, proxmox, 'Proxmox VE'],
  [/\b(?:synology|dsm)\b/i, synology, 'Synology DSM'],
  [/\balpine/i, alpinelinux, 'Alpine Linux'],
  [/\bubuntu/i, ubuntu, 'Ubuntu'],
  [/\bdebian/i, debian, 'Debian'],
  [/\bcentos/i, centos, 'CentOS'],
  [/\bfedora/i, fedora, 'Fedora'],
  [/\bred\s*hat|\brhel\b/i, redhat, 'Red Hat Enterprise Linux'],
  [/\brocky/i, rockylinux, 'Rocky Linux'],
  [/\barch(?:linux|\b)/i, archlinux, 'Arch Linux'],
  [/\bwindows/i, windows11, 'Windows'],
  [/\bmac\s*os|\bos x\b|\bdarwin\b/i, apple, 'macOS'],
  [/\balma\s*linux/i, almalinux, 'AlmaLinux'],
  [/\bopensuse/i, opensuse, 'openSUSE'],
  [/\bsuse/i, opensuse, 'SUSE Linux'],
  [/\bnixos/i, nixos, 'NixOS'],
  [/\bgentoo/i, gentoo, 'Gentoo'],
  [/\blinux\b/i, linux, 'Linux'],
];

function SystemIcon({ src }: { src?: string }) {
  if (!src) return <Monitor size={15} className="shrink-0" aria-hidden />;
  return (
    <img
      src={src}
      className={
        src === apple || src === linux ? 'shrink-0 in-[[data-theme=dark]]:invert' : 'shrink-0'
      }
      width={15}
      height={15}
      alt=""
    />
  );
}

export function NodeOSIcon({ os }: { os: string }) {
  return <SystemIcon src={systems.find(([pattern]) => pattern.test(os))?.[1]} />;
}

export function NodeOSLabel({ os, compact = false }: { os: string; compact?: boolean }) {
  const system = systems.find(([pattern]) => pattern.test(os));
  const reportedName = os.trim();
  const shortName =
    system && system[1] !== linux ? system[2] : reportedName.replace(/\s+v?\d.*$/i, '').trim();
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 align-middle">
      <SystemIcon src={system?.[1]} />
      <span className="min-w-0 wrap-anywhere">
        {(compact ? shortName : reportedName) || '尚未上报'}
      </span>
    </span>
  );
}
