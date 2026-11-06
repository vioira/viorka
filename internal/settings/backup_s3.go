package settings

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

func s3Client(location, credentialsConfig S3Config) *s3.Client {
	return s3.New(s3.Options{Region: location.Region, BaseEndpoint: optionalEndpoint(location.Endpoint), UsePathStyle: location.PathStyle, Credentials: credentials.NewStaticCredentialsProvider(credentialsConfig.AccessKey, credentialsConfig.SecretKey, ""), HTTPClient: &http.Client{Timeout: 2 * time.Minute, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, RetryMaxAttempts: 2})
}
func optionalEndpoint(s string) *string {
	if s == "" {
		return nil
	}
	return aws.String(s)
}
func objectKey(v Backup) string {
	prefix := strings.Trim(v.Remote.Prefix, "/")
	if prefix != "" {
		prefix += "/"
	}
	return prefix + v.Filename
}
func (b *Backups) upload(ctx context.Context, v Backup, credentialsConfig S3Config) error {
	f, err := os.Open(filepath.Join(b.dir, v.Filename))
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = s3Client(*v.Remote, credentialsConfig).PutObject(ctx, &s3.PutObjectInput{Bucket: aws.String(v.Remote.Bucket), Key: aws.String(objectKey(v)), Body: f, ContentType: aws.String("application/octet-stream")})
	if err != nil {
		return fmt.Errorf("S3 backup upload failed: %w", err)
	}
	return nil
}
func (b *Backups) deleteRemote(ctx context.Context, v Backup, credentialsConfig S3Config) error {
	_, err := s3Client(*v.Remote, deletionCredentials(*v.Remote, credentialsConfig)).DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: aws.String(v.Remote.Bucket), Key: aws.String(objectKey(v))})
	if err != nil {
		return fmt.Errorf("S3 backup deletion failed: %w", err)
	}
	return nil
}

// Never send newly configured credentials to a previous storage endpoint.
func deletionCredentials(location, current S3Config) S3Config {
	if location.Endpoint == current.Endpoint && location.Region == current.Region && location.Bucket == current.Bucket && current.SecretKey != "" {
		return current
	}
	return location
}
