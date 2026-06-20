#ifndef PUMP_H
#define PUMP_H
#include <Arduino.h>

#include <functional>
#include <vector>

using PumpCompleteCallback = std::function<void(int, int)>;

class Pump {
 private:
  const int pumpPin = 8;
  const unsigned long defaultPumpDuration = 10000;
  bool isPumping = false;
  unsigned long pumpStartTime = 0;
  int eventId;
  int pumpDuration;
  std::vector<PumpCompleteCallback> listeners;

 public:
  void begin() {
    pinMode(pumpPin, OUTPUT);
    digitalWrite(pumpPin, LOW);  // Ensure pump is OFF at start
  }

  void subscribe(PumpCompleteCallback cb) {
    listeners.push_back(cb);
  }

  void handleWaterPlantsEvent(int duration, int eventId) {
    if (!isPumping) {
      Serial.println("Action: Watering plants started...");
      Serial.print("eventId: ");
      Serial.print(eventId);
      Serial.print(" duration requested: ");
      Serial.print(duration);
      pumpDuration = duration > 0 ? duration : defaultPumpDuration;
      Serial.print(" pumpDuration set to: ");
      Serial.println(pumpDuration);
      this->eventId = eventId;
      digitalWrite(pumpPin, HIGH);
      pumpStartTime = millis();
      isPumping = true;
    } else {
      Serial.println("Pump already running, ignoring new command");
      Serial.print("current eventId: ");
      Serial.println(this->eventId);
    }
  }

  void update() {
    if (isPumping) {
      const int duration = millis() - pumpStartTime;
      if (duration >= pumpDuration) {
        stopPumping(duration);
      }
    }
  }

  void stopPumping(int duration) {
    digitalWrite(pumpPin, LOW);  // Turn pump OFF
    isPumping = false;
    Serial.println("Action: Watering complete. Pump OFF.");
    Serial.print("actual pump runtime: ");
    Serial.println(duration);
    Serial.print("reporting eventId: ");
    Serial.println(eventId);
    for (size_t i = 0; i < listeners.size(); i++) {
      if (listeners[i]) {
        listeners[i](duration, eventId);
      }
    }
  }

  bool currentlyPumping() {
    return isPumping;
  }
};

#endif
