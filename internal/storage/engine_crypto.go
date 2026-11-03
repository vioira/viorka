package storage

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"os"
)

func loadEngineKey(path string) ([]byte, error) {
	if info, err := os.Lstat(path); err == nil {
		if !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 || info.Size() != 32 {
			return nil, fmt.Errorf("unsafe engine key file")
		}
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	b, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		b = make([]byte, 32)
		if _, err = rand.Read(b); err != nil {
			return nil, err
		}
		f, e := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if e != nil {
			return nil, e
		}
		_, err = f.Write(b)
		if err == nil {
			err = f.Sync()
		}
		closeErr := f.Close()
		if err != nil {
			return nil, err
		}
		if closeErr != nil {
			return nil, closeErr
		}
	} else if err != nil {
		return nil, err
	}
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if len(b) != 32 || !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 {
		return nil, fmt.Errorf("engine key must be a private 32-byte regular file")
	}
	return b, nil
}
func (s *Store) engineAEAD() (cipher.AEAD, error) {
	b, e := aes.NewCipher(s.engineKey)
	if e != nil {
		return nil, e
	}
	return cipher.NewGCM(b)
}
func (s *Store) sealEngine(id string, b []byte) (string, error) {
	a, e := s.engineAEAD()
	if e != nil {
		return "", e
	}
	nonce := make([]byte, a.NonceSize())
	if _, e = rand.Read(nonce); e != nil {
		return "", e
	}
	return base64.RawStdEncoding.EncodeToString(a.Seal(nonce, nonce, b, []byte("engine-v1:"+id))), nil
}
func (s *Store) openEngine(id, encoded string) ([]byte, error) {
	a, e := s.engineAEAD()
	if e != nil {
		return nil, e
	}
	b, e := base64.RawStdEncoding.DecodeString(encoded)
	if e != nil || len(b) < a.NonceSize() {
		return nil, fmt.Errorf("invalid encrypted engine payload")
	}
	return a.Open(nil, b[:a.NonceSize()], b[a.NonceSize():], []byte("engine-v1:"+id))
}
