import { Icon, cx } from "@kade/ui";
import { playCheck, playNewOrder, unlockAudio } from "./sound";
import { useSound } from "./store";
import styles from "./SoundControl.module.css";

/**
 * Sound on/off for new orders. When sound is wanted but the browser hasn't allowed it yet, the
 * button says "Turn on sound" and stands out, because a silent tablet means missed orders.
 */
export function SoundControl({ ordersWaiting }: { ordersWaiting: boolean }) {
  const { soundOn, unlocked, setSoundOn, setUnlocked } = useSound();
  const blocked = soundOn && !unlocked;

  const turnOn = async () => {
    const ok = await unlockAudio();
    setUnlocked(ok);
    setSoundOn(true);
    if (ok) {
      if (ordersWaiting) playNewOrder();
      else playCheck();
    }
  };

  if (blocked) {
    return (
      <button type="button" className={cx(styles.button, styles.blocked)} onClick={turnOn}>
        <Icon name="bell" size={22} />
        Turn on sound
      </button>
    );
  }
  return (
    <button
      type="button"
      aria-pressed={soundOn}
      className={cx(styles.button, !soundOn && styles.off)}
      onClick={() => (soundOn ? setSoundOn(false) : void turnOn())}
    >
      <Icon name="bell" size={22} />
      <span className={styles.text}>Sound {soundOn ? "on" : "off"}</span>
    </button>
  );
}
